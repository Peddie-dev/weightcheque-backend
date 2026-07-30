import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/prisma';
import { config } from '../../config';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../middleware/errorHandler';
import { emailService } from './email.service';

export interface RegisterDto { email: string; password: string; name: string; }
export interface LoginDto    { email: string; password: string; }

export interface OnboardingDto {
  firstName?:          string;
  lastName?:           string;
  gender?:             string;
  dateOfBirth?:        string;
  height?:             number;
  waistCircumference?: number;
  currentWeight:       number;
  targetWeight:        number;
  medicalConditions?:  string[];
  medications?:        string;
  allergies:           string[];
  sleepHours?:         string;
  goalType:            string;
  activityLevel:       string;
  focusTime?:          string;
  dietType:            string;
  mealsPerDay:         number;
  foodTriggers?:       string;
}

// ─── OTP helpers ──────────────────────────────────────────────────────────────

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const authService = {

  async register(dto: RegisterDto) {
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new AppError('Email already in use', 409);

    const passwordHash = await bcrypt.hash(dto.password, config.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
      select: { id: true, email: true, name: true, role: true },
    });

    // Send welcome email (non-blocking)
    emailService.sendWelcome(user.email, user.name).catch(() => {});

    const tokens = await this._issueTokens(user.id, user.email, user.role);
    return { user, ...tokens };
  },

  async login(dto: LoginDto) {
    const user = await prisma.user.findUnique({
      where:   { email: dto.email },
      include: { profile: true },
    });
    if (!user) throw new AppError('Invalid credentials', 401);

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new AppError('Invalid credentials', 401);

    const tokens = await this._issueTokens(user.id, user.email, user.role);
    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  },

  async refresh(refreshToken: string) {
    try { verifyRefreshToken(refreshToken); }
    catch { throw new AppError('Invalid refresh token', 401); }

    const stored = await prisma.refreshToken.findUnique({
      where:   { token: refreshToken },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError('Refresh token expired or revoked', 401);
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data:  { revokedAt: new Date() },
    });
    return this._issueTokens(stored.user.id, stored.user.email, stored.user.role);
  },

  async logout(refreshToken: string) {
    await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data:  { revokedAt: new Date() },
    });
  },

  // ── Forgot password ────────────────────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!user) return { message: 'If that email exists, a reset code has been sent.' };

    const otp       = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate any existing OTPs for this user
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    // Store hashed OTP
    const otpHash = await bcrypt.hash(otp, 10);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: otpHash, expiresAt },
    });

    // Send email
    await emailService.sendOtp(email, otp, user.name);

    return { message: 'Reset code sent to your email.' };
  },

  // ── Verify OTP ─────────────────────────────────────────────────────────────

  async verifyOtp(email: string, otp: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('Invalid code', 400);

    const record = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new AppError('Invalid or expired code', 400);
    if (record.expiresAt < new Date()) throw new AppError('Code has expired. Please request a new one.', 400);

    const valid = await bcrypt.compare(otp, record.tokenHash);
    if (!valid) throw new AppError('Invalid code', 400);

    // Return a short-lived reset token the client uses for the next step
    const resetToken = uuidv4();
    const resetHash  = await bcrypt.hash(resetToken, 10);

    await prisma.passwordResetToken.update({
      where: { id: record.id },
      data:  { tokenHash: resetHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    return { resetToken };
  },

  // ── Reset password ─────────────────────────────────────────────────────────

  async resetPassword(email: string, resetToken: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('Invalid request', 400);

    const record = await prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new AppError('Invalid or expired reset session', 400);
    if (record.expiresAt < new Date()) throw new AppError('Reset session expired. Please start again.', 400);

    const valid = await bcrypt.compare(resetToken, record.tokenHash);
    if (!valid) throw new AppError('Invalid reset session', 400);

    // Update password and mark token as used
    const passwordHash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await Promise.all([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // Revoke all refresh tokens for security
      prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } }),
    ]);

    return { message: 'Password reset successfully. Please log in.' };
  },

  // ── Onboarding ─────────────────────────────────────────────────────────────

  async completeOnboarding(userId: string, dto: OnboardingDto) {
    const dailyKcalGoal = this._calculateKcal(
      dto.currentWeight,
      dto.activityLevel,
      dto.goalType,
      dto.gender,
    );

    if (dto.firstName || dto.lastName) {
      const fullName = [dto.firstName, dto.lastName].filter(Boolean).join(' ');
      await prisma.user.update({ where: { id: userId }, data: { name: fullName } });
    }

    const profile = await prisma.userProfile.upsert({
      where:  { userId },
      update: {
        goalType: dto.goalType as any, currentWeight: dto.currentWeight,
        targetWeight: dto.targetWeight, height: dto.height,
        waistCircumference: dto.waistCircumference, activityLevel: dto.activityLevel as any,
        dietType: dto.dietType as any, allergies: dto.allergies,
        mealsPerDay: dto.mealsPerDay, dailyKcalGoal,
        gender: dto.gender, dateOfBirth: dto.dateOfBirth,
        medicalConditions: dto.medicalConditions ?? [],
        medications: dto.medications, sleepHours: dto.sleepHours,
        focusTime: dto.focusTime, foodTriggers: dto.foodTriggers,
      },
      create: {
        userId, goalType: dto.goalType as any,
        startWeight: dto.currentWeight, currentWeight: dto.currentWeight,
        targetWeight: dto.targetWeight, height: dto.height,
        waistCircumference: dto.waistCircumference, activityLevel: dto.activityLevel as any,
        dietType: dto.dietType as any, allergies: dto.allergies,
        mealsPerDay: dto.mealsPerDay, dailyKcalGoal,
        gender: dto.gender, dateOfBirth: dto.dateOfBirth,
        medicalConditions: dto.medicalConditions ?? [],
        medications: dto.medications, sleepHours: dto.sleepHours,
        focusTime: dto.focusTime, foodTriggers: dto.foodTriggers,
      },
    });

    await prisma.weightEntry.create({ data: { userId, weight: dto.currentWeight } });
    return profile;
  },

  async getMe(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, role: true,
        isEmailVerified: true, avatarUrl: true,
        createdAt: true, updatedAt: true,
        profile: true, subscription: true,
      },
    });
  },

  async _issueTokens(userId: string, email: string, role: string) {
    const accessToken  = signAccessToken({ userId, email, role });
    const tokenId      = uuidv4();
    const refreshToken = signRefreshToken({ userId, tokenId });
    const expiresAt    = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId, expiresAt } });
    return { accessToken, refreshToken };
  },

  _calculateKcal(weight: number, activity: string, goal: string, gender?: string): number {
    const bmr = gender === 'male' ? 10 * weight + 500 : 10 * weight + 300;
    const mult: Record<string, number> = {
      SEDENTARY: 1.2, LIGHT: 1.375, MODERATE: 1.55, VERY_ACTIVE: 1.725,
    };
    const tdee = bmr * (mult[activity] ?? 1.55);
    if (goal === 'LOSE_WEIGHT')    return Math.round(tdee - 500);
    if (goal === 'GAIN_MUSCLE')    return Math.round(tdee + 300);
    return Math.round(tdee);
  },
};