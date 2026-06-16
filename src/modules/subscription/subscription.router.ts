import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendBadRequest, sendError } from '../../utils/response';
import { subscriptionService } from './subscription.service';
import { config } from '../../config';
import { logger } from '../../config/logger';

const router = Router();

const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { sendBadRequest(res, 'Validation failed', errors.array()); return; }
  next();
};

// GET /subscription/plans — public
router.get('/plans', (_req: Request, res: Response) => {
  sendSuccess(res, subscriptionService.getPlans());
});

// GET /subscription — current user's subscription
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await subscriptionService.getSubscription(req.user!.userId);
    sendSuccess(res, result);
  } catch (err) { next(err); }
});

// POST /subscription/initiate — start payment flow
router.post('/initiate',
  authenticate,
  [body('planId').isIn(['monthly', 'yearly'])],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await subscriptionService.initiatePayment(req.user!.userId, req.body.planId);
      sendSuccess(res, result, 'Payment initialised');
    } catch (err) { next(err); }
  }
);

// GET /subscription/callback — Paystack redirects here after payment
// React Native will open this URL in a WebView / browser; on success
// the app should deep-link back and call GET /subscription to confirm status.
router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { reference, trxref } = req.query as Record<string, string>;
    const ref = reference ?? trxref;
    if (!ref) { res.status(400).send('Missing reference'); return; }

    await subscriptionService.verifyTransaction(ref);

    // Redirect to app deep link or a success page
    res.redirect(`${config.APP_URL}/subscription/success?reference=${ref}`);
  } catch (err) {
    logger.error('Subscription callback error', { err });
    res.redirect(`${config.APP_URL}/subscription/failed`);
  }
});

// POST /subscription/verify — called by app after WebView returns
router.post('/verify',
  authenticate,
  [body('reference').notEmpty()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await subscriptionService.verifyTransaction(req.body.reference);
      sendSuccess(res, result, 'Subscription activated');
    } catch (err) { next(err); }
  }
);

// POST /subscription/cancel
router.post('/cancel', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await subscriptionService.cancelSubscription(req.user!.userId);
    sendSuccess(res, result, 'Subscription cancelled — active until end of billing period');
  } catch (err) { next(err); }
});

// POST /subscription/webhook — Paystack sends events here
// IMPORTANT: Use raw body for signature verification
router.post('/webhook', async (req: Request, res: Response) => {
  const hash = crypto
    .createHmac('sha512', config.PAYSTACK_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    logger.warn('Invalid Paystack webhook signature');
    res.status(401).json({ message: 'Invalid signature' });
    return;
  }

  // Respond immediately — process async
  res.sendStatus(200);

  const { event, data } = req.body;
  subscriptionService.handleWebhook(event, data).catch((err) =>
    logger.error('Webhook handler error', { event, err })
  );
});

export default router;
