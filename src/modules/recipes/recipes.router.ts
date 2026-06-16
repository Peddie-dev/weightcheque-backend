import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { optionalAuth } from '../../middleware/auth';
import { sendSuccess, sendError } from '../../utils/response';
import { config } from '../../config';
import { logger } from '../../config/logger';

const router = Router();

// ── In-memory cache (replace with Redis in production) ───────────────────────
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached<T>(key: string): T | null {
  const e = cache.get(key);
  if (!e || e.expiresAt < Date.now()) { cache.delete(key); return null; }
  return e.data as T;
}
function setCache(key: string, data: unknown) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

const strapi = axios.create({
  baseURL: config.STRAPI_BASE_URL,
  headers: { Authorization: `Bearer ${config.STRAPI_API_TOKEN}` },
  timeout: 8000,
});

// ── Normalise Strapi v4 shape → app Recipe shape ─────────────────────────────
function normalise(item: any) {
  const a = item.attributes ?? item;
  const imgFormats = a.image?.data?.attributes?.formats;
  const rawUrl = imgFormats?.medium?.url ?? imgFormats?.small?.url ?? a.image?.data?.attributes?.url ?? null;
  const imageUrl = rawUrl
    ? rawUrl.startsWith('http') ? rawUrl : `${config.STRAPI_BASE_URL}${rawUrl}`
    : null;

  return {
    id:           String(item.id),
    name:         a.name ?? '',
    type:         a.mealType ?? 'BREAKFAST',
    kcal:         a.nutritionInfo?.kcal     ?? 0,
    protein:      a.nutritionInfo?.protein  ?? 0,
    carbs:        a.nutritionInfo?.carbs    ?? 0,
    fats:         a.nutritionInfo?.fats     ?? 0,
    fiber:        a.nutritionInfo?.fiber    ?? 0,
    imageUrl,
    ingredients:  a.ingredients  ?? [],
    instructions: a.instructions ?? [],
    tags:         a.tags?.data?.map((t: any) => t.attributes.name) ?? [],
    dietTypes:    a.dietTypes    ?? [],
    allergens:    a.allergens    ?? [],
    prepTimeMins: a.prepTimeMins ?? 0,
    category:     a.category?.data?.attributes?.name ?? null,
    featured:     a.featured ?? false,
    slug:         a.slug ?? null,
    source:       'strapi',
  };
}

// GET /recipes
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { search, category, dietType, mealType, maxKcal, page = '1', pageSize = '20', sort = 'createdAt:desc' } = req.query as Record<string, string>;
    const cacheKey = `recipes:${JSON.stringify(req.query)}`;
    const cached = getCached(cacheKey);
    if (cached) { sendSuccess(res, cached, 'Recipes (cached)'); return; }

    const params: Record<string, unknown> = {
      'pagination[page]': page, 'pagination[pageSize]': pageSize, sort,
      populate: ['image', 'category', 'tags', 'nutritionInfo'],
    };
    if (search)   params['filters[name][$containsi]']              = search;
    if (category) params['filters[category][slug][$eq]']           = category;
    if (dietType) params['filters[dietTypes][$contains]']          = dietType.toUpperCase();
    if (mealType) params['filters[mealType][$eq]']                 = mealType.toUpperCase();
    if (maxKcal)  params['filters[nutritionInfo][kcal][$lte]']     = parseInt(maxKcal);

    const { data } = await strapi.get('/api/recipes', { params });
    const result = { recipes: data.data.map(normalise), pagination: data.meta?.pagination };
    setCache(cacheKey, result);
    sendSuccess(res, result);
  } catch (err) {
    logger.error('Strapi recipe list failed', { err });
    sendError(res, 'Failed to fetch recipes', 502);
  }
});

// GET /recipes/meta/featured
router.get('/meta/featured', optionalAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'recipe:featured';
    const cached = getCached(cacheKey);
    if (cached) { sendSuccess(res, cached); return; }
    const { data } = await strapi.get('/api/recipes', {
      params: { 'filters[featured][$eq]': true, 'pagination[pageSize]': 6, populate: ['image', 'category'], sort: 'createdAt:desc' },
    });
    const recipes = data.data.map(normalise);
    setCache(cacheKey, recipes);
    sendSuccess(res, recipes);
  } catch {
    sendError(res, 'Failed to fetch featured recipes', 502);
  }
});

// GET /recipes/meta/categories
router.get('/meta/categories', optionalAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'recipe:categories';
    const cached = getCached(cacheKey);
    if (cached) { sendSuccess(res, cached); return; }
    const { data } = await strapi.get('/api/recipe-categories', { params: { fields: ['name', 'slug', 'icon'], sort: 'name:asc' } });
    const categories = data.data.map((c: any) => ({ id: c.id, name: c.attributes.name, slug: c.attributes.slug, icon: c.attributes.icon }));
    setCache(cacheKey, categories);
    sendSuccess(res, categories);
  } catch {
    sendError(res, 'Failed to fetch categories', 502);
  }
});

// GET /recipes/:id
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  try {
    const cacheKey = `recipe:${req.params.id}`;
    const cached = getCached(cacheKey);
    if (cached) { sendSuccess(res, cached); return; }
    const { data } = await strapi.get(`/api/recipes/${req.params.id}`, {
      params: { populate: ['image', 'category', 'tags', 'nutritionInfo', 'ingredients', 'instructions'] },
    });
    const recipe = normalise(data.data);
    setCache(cacheKey, recipe);
    sendSuccess(res, recipe);
  } catch (err: any) {
    if (err.response?.status === 404) { res.status(404).json({ success: false, message: 'Recipe not found' }); return; }
    sendError(res, 'Failed to fetch recipe', 502);
  }
});

export default router;
