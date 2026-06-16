/**
 * WeightCheque API Service — React Native client
 *
 * Drop this file into src/api/apiService.ts in the React Native project,
 * replacing the previous mock-mode version.
 *
 * All requests attach the JWT from AsyncStorage automatically.
 * Token refresh is handled transparently via an Axios interceptor.
 */

import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __DEV__
  ? 'http://localhost:4000/api/v1'          // local dev
  : 'https://api.yourapp.com/api/v1';       // production

// ─── Axios instance ────────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Attach access token to every request ──────────────────────────────────────
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await AsyncStorage.getItem('@wc:access_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auto-refresh on 401 ────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await AsyncStorage.getItem('@wc:refresh_token');
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = data.data;

        await AsyncStorage.multiSet([
          ['@wc:access_token',  accessToken],
          ['@wc:refresh_token', newRefresh],
        ]);

        refreshQueue.forEach((cb) => cb(accessToken));
        refreshQueue = [];

        original.headers = { ...original.headers, Authorization: `Bearer ${accessToken}` };
        return api(original);
      } catch {
        // Refresh failed — clear tokens, force logout
        await AsyncStorage.multiRemove(['@wc:access_token', '@wc:refresh_token']);
        refreshQueue = [];
        // Emit event so app can redirect to login
        // e.g. navigationRef.current?.navigate('Login');
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Token helpers ─────────────────────────────────────────────────────────────

export const tokenStorage = {
  save: (accessToken: string, refreshToken: string) =>
    AsyncStorage.multiSet([['@wc:access_token', accessToken], ['@wc:refresh_token', refreshToken]]),
  clear: () =>
    AsyncStorage.multiRemove(['@wc:access_token', '@wc:refresh_token']),
};

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  register: async (name: string, email: string, password: string) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    await tokenStorage.save(data.data.accessToken, data.data.refreshToken);
    return data.data;
  },

  login: async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    await tokenStorage.save(data.data.accessToken, data.data.refreshToken);
    return data.data;
  },

  logout: async () => {
    const refreshToken = await AsyncStorage.getItem('@wc:refresh_token');
    try { await api.post('/auth/logout', { refreshToken }); } catch { /* ignore */ }
    await tokenStorage.clear();
  },

  me: async ()                => (await api.get('/auth/me')).data.data,

  onboarding: async (dto: {
    goalType: string; currentWeight: number; targetWeight: number;
    height?: number; activityLevel: string; dietType: string;
    allergies: string[]; mealsPerDay: number;
  }) => (await api.post('/auth/onboarding', dto)).data.data,
};

// ─── Meals ─────────────────────────────────────────────────────────────────────

export const mealsApi = {
  browse: async (params?: {
    type?: string; dietType?: string; maxKcal?: number;
    search?: string; page?: number; limit?: number;
  }) => (await api.get('/meals', { params })).data,

  getById: async (id: string)             => (await api.get(`/meals/${id}`)).data.data,
  getAlternatives: async (id: string)     => (await api.get(`/meals/${id}/alternatives`)).data.data,
  getTodaysPlan: async ()                 => (await api.get('/meals/plan/today')).data.data,
  getWeekPlan: async ()                   => (await api.get('/meals/plan/week')).data.data,
  getTodaysLog: async ()                  => (await api.get('/meals/log/today')).data.data,

  completePlanItem: async (itemId: string) =>
    (await api.post(`/meals/plan/items/${itemId}/complete`)).data.data,

  logMeal: async (dto: {
    name: string; mealType: string; kcal: number;
    protein?: number; carbs?: number; fats?: number; mealId?: string; notes?: string;
  }) => (await api.post('/meals/log', dto)).data.data,
};

// ─── Progress ──────────────────────────────────────────────────────────────────

export const progressApi = {
  logWeight:       async (weight: number, note?: string) =>
    (await api.post('/progress/weight', { weight, note })).data.data,

  getWeightHistory: async (days = 30) =>
    (await api.get('/progress/weight', { params: { days } })).data.data,

  logWater:        async (amount: number) =>
    (await api.post('/progress/water', { amount })).data.data,

  getTodaysWater:  async ()  => (await api.get('/progress/water/today')).data.data,
  getAchievements: async ()  => (await api.get('/progress/achievements')).data.data,
  getStreak:       async ()  => (await api.get('/progress/streak')).data.data,
  getSummary:      async ()  => (await api.get('/progress/summary')).data.data,
};

// ─── Grocery ───────────────────────────────────────────────────────────────────

export const groceryApi = {
  getList:         async ()                    => (await api.get('/grocery')).data.data,
  generateList:    async ()                    => (await api.post('/grocery/generate')).data.data,
  resetList:       async ()                    => (await api.post('/grocery/reset')).data.data,
  toggleItem:      async (itemId: string)      => (await api.patch(`/grocery/items/${itemId}`)).data.data,
  deleteItem:      async (itemId: string)      => (await api.delete(`/grocery/items/${itemId}`)).data.data,
  addItem:         async (dto: {
    name: string; quantity: string; category: string; estimatedCost?: number; note?: string;
  }) => (await api.post('/grocery/items', dto)).data.data,
};

// ─── Recipes (Strapi via backend proxy) ────────────────────────────────────────

export const recipesApi = {
  browse: async (params?: {
    search?: string; category?: string; dietType?: string;
    mealType?: string; maxKcal?: number; page?: number; pageSize?: number;
  }) => (await api.get('/recipes', { params })).data.data,

  getById:       async (id: string) => (await api.get(`/recipes/${id}`)).data.data,
  getFeatured:   async ()           => (await api.get('/recipes/meta/featured')).data.data,
  getCategories: async ()           => (await api.get('/recipes/meta/categories')).data.data,
};

// ─── Subscription (Paystack) ───────────────────────────────────────────────────

export const subscriptionApi = {
  getPlans:    async ()             => (await api.get('/subscription/plans')).data.data,
  getCurrent:  async ()             => (await api.get('/subscription')).data.data,

  initiate: async (planId: 'monthly' | 'yearly') => {
    const { data } = await api.post('/subscription/initiate', { planId });
    return data.data as { authorizationUrl: string; accessCode: string; reference: string };
  },

  // Call this after the WebView/browser returns from Paystack
  verify: async (reference: string) =>
    (await api.post('/subscription/verify', { reference })).data.data,

  cancel: async () => (await api.post('/subscription/cancel')).data.data,
};

// ─── Messaging ─────────────────────────────────────────────────────────────────

export const messagingApi = {
  getConversations: async () =>
    (await api.get('/messaging/conversations')).data.data,

  getOrCreateConversation: async (otherUserId: string) =>
    (await api.post('/messaging/conversations', { otherUserId })).data.data,

  getMessages: async (conversationId: string, page = 1) =>
    (await api.get(`/messaging/conversations/${conversationId}/messages`, { params: { page } })).data.data,

  sendMessage: async (conversationId: string, body: string) =>
    (await api.post(`/messaging/conversations/${conversationId}/messages`, { body })).data.data,

  markRead: async (conversationId: string) =>
    api.patch(`/messaging/conversations/${conversationId}/read`),

  getUnreadCount: async () =>
    (await api.get('/messaging/unread-count')).data.data,
};

// ─── Notifications ─────────────────────────────────────────────────────────────

export const notificationsApi = {
  registerToken: async (token: string, platform: 'ios' | 'android') =>
    api.post('/notifications/token', { token, platform }),

  deactivateToken: async (token: string) =>
    api.delete('/notifications/token', { data: { token } }),

  getAll:   async (limit = 30)       => (await api.get('/notifications', { params: { limit } })).data.data,
  markRead: async (id: string)       => api.patch(`/notifications/${id}/read`),
  markAllRead: async ()              => api.patch('/notifications/read-all'),
};

export default api;
