import axios from 'axios';
import prisma from '../../config/prisma';
import { config } from '../../config';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { notificationService } from '../notifications/notification.service';

// ── Paystack axios client ─────────────────────────────────────────────────────

const paystack = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

// ── Plan definitions ──────────────────────────────────────────────────────────

export const PLANS = [
  {
    id: 'monthly',
    planCode: config.PAYSTACK_MONTHLY_PLAN_CODE,
    label: 'Monthly',
    price: 999,        // in kobo/pesewas/cents (e.g. ₦999 = 99900 kobo — adjust to your currency)
    currency: config.PAYSTACK_CURRENCY,
    interval: 'monthly',
    savings: null,
    description: 'Billed monthly. Cancel anytime.',
  },
  {
    id: 'yearly',
    planCode: config.PAYSTACK_YEARLY_PLAN_CODE,
    label: 'Yearly',
    price: 7999,
    currency: config.PAYSTACK_CURRENCY,
    interval: 'annually',
    savings: 33,
    description: 'Best value. Billed once a year.',
  },
];

export const subscriptionService = {
  // ── Get current subscription ───────────────────────────────────────────────

  async getSubscription(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    const plan = PLANS.find((p) => p.planCode === sub?.paystackPlanCode) ?? null;
    return { subscription: sub, plan };
  },

  // ── Get available plans ────────────────────────────────────────────────────

  getPlans() {
    return PLANS.map(({ planCode: _, ...rest }) => rest); // strip internal planCode
  },

  // ── Initialise transaction → returns Paystack authorization URL ───────────

  async initiatePayment(userId: string, planId: string) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw new AppError('Invalid plan', 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    // Paystack: initialize a transaction that creates a subscription on success
    const { data } = await paystack.post('/transaction/initialize', {
      email: user.email,
      amount: plan.price * 100,   // convert to smallest currency unit
      plan: plan.planCode,
      currency: plan.currency,
      metadata: {
        userId,
        planId,
        cancel_action: `${config.APP_URL}/subscription/cancel`,
      },
      callback_url: `${config.API_BASE_URL}/api/v1/subscription/callback`,
    });

    if (!data.status) throw new AppError('Payment initialisation failed', 502);

    logger.info(`Payment initialised for user ${userId}, plan ${planId}`);
    return {
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    };
  },

  // ── Verify transaction after redirect ─────────────────────────────────────

  async verifyTransaction(reference: string) {
    const { data } = await paystack.get(`/transaction/verify/${reference}`);

    if (!data.status || data.data.status !== 'success') {
      throw new AppError('Payment verification failed', 400);
    }

    const { metadata, customer, plan, paid_at, subscription } = data.data;
    const userId = metadata?.userId;
    if (!userId) throw new AppError('Missing userId in transaction metadata', 400);

    const planDef = PLANS.find((p) => p.planCode === plan?.plan_code);

    await prisma.subscription.upsert({
      where: { userId },
      update: {
        paystackCustomerId:      customer.customer_code,
        paystackSubscriptionCode: subscription?.subscription_code ?? null,
        paystackPlanCode:        plan?.plan_code ?? null,
        status:                  'ACTIVE',
        interval:                planDef?.id === 'yearly' ? 'YEARLY' : 'MONTHLY',
        currentPeriodStart:      new Date(paid_at),
        currentPeriodEnd:        this._periodEnd(planDef?.interval ?? 'monthly', new Date(paid_at)),
        cancelAtPeriodEnd:       false,
        canceledAt:              null,
      },
      create: {
        userId,
        paystackCustomerId:      customer.customer_code,
        paystackSubscriptionCode: subscription?.subscription_code ?? null,
        paystackPlanCode:        plan?.plan_code ?? null,
        status:                  'ACTIVE',
        interval:                planDef?.id === 'yearly' ? 'YEARLY' : 'MONTHLY',
        currentPeriodStart:      new Date(paid_at),
        currentPeriodEnd:        this._periodEnd(planDef?.interval ?? 'monthly', new Date(paid_at)),
      },
    });

    await notificationService.sendToUser(userId, {
      title: '🎉 Welcome to Premium!',
      body: `Your ${planDef?.label ?? ''} plan is now active. Enjoy unlimited features!`,
      data: { type: 'subscription_activated' },
    });

    logger.info(`Subscription activated for user ${userId}`);
    return { success: true, userId, plan: planDef };
  },

  // ── Cancel subscription ────────────────────────────────────────────────────

  async cancelSubscription(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub) throw new AppError('No subscription found', 404);
    if (sub.status !== 'ACTIVE') throw new AppError('Subscription is not active', 400);

    if (sub.paystackSubscriptionCode) {
      // Disable on Paystack
      await paystack.post('/subscription/disable', {
        code:  sub.paystackSubscriptionCode,
        token: sub.paystackEmailToken,
      });
    }

    await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
    });

    await notificationService.sendToUser(userId, {
      title: 'Subscription Cancelled',
      body: `Your plan will stay active until ${sub.currentPeriodEnd?.toLocaleDateString() ?? 'end of period'}.`,
      data: { type: 'subscription_cancelled' },
    });

    logger.info(`Subscription cancelled for user ${userId}`);
    return { cancelAtPeriodEnd: true, activeUntil: sub.currentPeriodEnd };
  },

  // ── Handle Paystack webhook events ────────────────────────────────────────

  async handleWebhook(event: string, data: any) {
    logger.info(`Paystack webhook: ${event}`);

    switch (event) {
      case 'charge.success':
        // Recurring charge succeeded — extend period
        await this._handleChargeSuccess(data);
        break;

      case 'subscription.disable':
        // Subscription disabled (cancelled or payment failure)
        await this._handleSubscriptionDisable(data);
        break;

      case 'subscription.not_renew':
        // Subscription set to not renew
        await this._handleNotRenew(data);
        break;

      case 'invoice.payment_failed':
        // Recurring payment failed
        await this._handlePaymentFailed(data);
        break;

      default:
        logger.debug(`Unhandled Paystack event: ${event}`);
    }
  },

  // ── Webhook handlers ──────────────────────────────────────────────────────

  async _handleChargeSuccess(data: any) {
    const subscriptionCode = data.subscription_code;
    if (!subscriptionCode) return;

    const sub = await prisma.subscription.findFirst({
      where: { paystackSubscriptionCode: subscriptionCode },
    });
    if (!sub) return;

    const planDef = PLANS.find((p) => p.planCode === sub.paystackPlanCode);
    const newEnd  = this._periodEnd(planDef?.interval ?? 'monthly', new Date());

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: newEnd, cancelAtPeriodEnd: false },
    });

    await notificationService.sendToUser(sub.userId, {
      title: '✅ Payment Successful',
      body:  'Your subscription has been renewed. Thank you!',
      data:  { type: 'payment_success' },
    });
  },

  async _handleSubscriptionDisable(data: any) {
    const sub = await prisma.subscription.findFirst({
      where: { paystackSubscriptionCode: data.subscription_code },
    });
    if (!sub) return;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELED' },
    });

    await notificationService.sendToUser(sub.userId, {
      title: 'Subscription Ended',
      body:  'Your premium subscription has ended. Upgrade anytime to continue.',
      data:  { type: 'subscription_ended' },
    });
  },

  async _handleNotRenew(data: any) {
    const sub = await prisma.subscription.findFirst({
      where: { paystackSubscriptionCode: data.subscription_code },
    });
    if (!sub) return;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    });
  },

  async _handlePaymentFailed(data: any) {
    const sub = await prisma.subscription.findFirst({
      where: { paystackSubscriptionCode: data.subscription?.subscription_code },
    });
    if (!sub) return;

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'PAST_DUE' },
    });

    await notificationService.sendToUser(sub.userId, {
      title: '⚠️ Payment Failed',
      body:  'We could not process your subscription payment. Please update your payment method.',
      data:  { type: 'payment_failed' },
    });
  },

  // ── Utility ───────────────────────────────────────────────────────────────

  _periodEnd(interval: string, from: Date): Date {
    const d = new Date(from);
    if (interval === 'annually') d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d;
  },
};
