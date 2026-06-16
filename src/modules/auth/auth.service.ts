import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/prisma';
import { config } from '../../config';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { AppError } from '../../middleware/errorHandler';

export interface RegisterDto { email: string; password: string; name: string; }
export interface LoginDto    { email: string; password: string; }
export interface OnboardingDto {
  goalType: string; currentWeight: number; targetWeight: number;
  height?: number; activityLevel: string; dietType: string;
  allergies: string[]; mealsPerDay: number;
}

export const authService = {
  async register(dto: RegisterDto) {
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new AppError('Email already in use', 409);

    const passwordHash = await bcrypt.hash(dto.password, config.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email: dto.email, passwordHash, name: dto.name },
      select: { id: true, email: true, name: true, role: true },
    });

    const tokens = await this._issueTokens(user.id, user.email, user.role);
    return { user, ...tokens };
  },

  async login(dto: LoginDto) {
    const user = await prisma.user.findUnique({ where: { email: dto.email }, include: { profile: true } });
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
      where: { token: refreshToken },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppError('Refresh token expired or revoked', 401);
    }

    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this._issueTokens(stored.user.id, stored.user.email, stored.user.role);
  },

  async logout(refreshToken: string) {
    await prisma.refreshToken.updateMany({ where: { token: refreshToken }, data: { revokedAt: new Date() } });
  },

  async completeOnboarding(userId: string, dto: OnboardingDto) {
    const dailyKcalGoal = this._calculateKcal(dto.currentWeight, dto.activityLevel, dto.goalType);

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {
        goalType: dto.goalType as any, currentWeight: dto.currentWeight,
        targetWeight: dto.targetWeight, height: dto.height,
        activityLevel: dto.activityLevel as any, dietType: dto.dietType as any,
        allergies: dto.allergies, mealsPerDay: dto.mealsPerDay, dailyKcalGoal,
      },
      create: {
        userId, goalType: dto.goalType as any,
        startWeight: dto.currentWeight, currentWeight: dto.currentWeight,
        targetWeight: dto.targetWeight, height: dto.height,
        activityLevel: dto.activityLevel as any, dietType: dto.dietType as any,
        allergies: dto.allergies, mealsPerDay: dto.mealsPerDay, dailyKcalGoal,
      },
    });

    await prisma.weightEntry.create({ data: { userId, weight: dto.currentWeight } });
    return profile;
  },

  async getMe(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      // Use `select` so we never accidentally expose `passwordHash`.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isEmailVerified: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
        subscription: true,
      },
    });
  },

  async _issueTokens(userId: string, email: string, role: string) {
    const accessToken = signAccessToken({ userId, email, role });
    const tokenId = uuidv4();
    const refreshToken = signRefreshToken({ userId, tokenId });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId, expiresAt } });
    return { accessToken, refreshToken };
  },

  _calculateKcal(weight: number, activity: string, goal: string): number {
    const bmr = 10 * weight + 500;
    const mult: Record<string, number> = { SEDENTARY: 1.2, LIGHT: 1.375, MODERATE: 1.55, VERY_ACTIVE: 1.725 };
    const tdee = bmr * (mult[activity] ?? 1.55);
    if (goal === 'LOSE_WEIGHT') return Math.round(tdee - 500);
    if (goal === 'GAIN_MUSCLE') return Math.round(tdee + 300);
    return Math.round(tdee);
  },
};
