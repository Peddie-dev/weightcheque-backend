import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import prisma from '../../config/prisma';
import { authenticate } from '../../middleware/auth';
import { sendSuccess, sendCreated, sendNotFound } from '../../utils/response';
import { achievementService } from '../progress/achievement.service';
import { GroceryCategory } from '@prisma/client';

const router = Router();
router.use(authenticate);

// GET /grocery — current week's list (auto-generate if missing)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    let list = await prisma.groceryList.findFirst({
      where: { userId },
      orderBy: { weekStart: 'desc' },
      include: { items: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] } },
    });

    if (!list) list = await generateGroceryList(userId);

    const checkedCount = list.items.filter((i) => i.checked).length;
    const totalCost    = list.items.reduce((s, i) => s + (i.estimatedCost ?? 0), 0);
    const remainingCost = list.items.filter((i) => !i.checked).reduce((s, i) => s + (i.estimatedCost ?? 0), 0);

    const grouped = list.items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {} as Record<string, typeof list.items>);

    sendSuccess(res, {
      ...list, grouped,
      stats: {
        totalItems: list.items.length, checkedCount,
        remainingCount: list.items.length - checkedCount,
        completionPct: list.items.length ? Math.round((checkedCount / list.items.length) * 100) : 0,
        totalCost: parseFloat(totalCost.toFixed(2)),
        remainingCost: parseFloat(remainingCost.toFixed(2)),
      },
    });
  } catch (err) { next(err); }
});

// POST /grocery/generate — force regenerate from meal plan
router.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await generateGroceryList(req.user!.userId, true);
    sendCreated(res, list, 'Grocery list generated from your meal plan');
  } catch (err) { next(err); }
});

// POST /grocery/reset — uncheck all
router.post('/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await prisma.groceryList.findFirst({ where: { userId: req.user!.userId }, orderBy: { weekStart: 'desc' } });
    if (!list) { sendNotFound(res, 'No grocery list found'); return; }
    await prisma.groceryItem.updateMany({ where: { groceryListId: list.id }, data: { checked: false, checkedAt: null } });
    sendSuccess(res, null, 'List reset');
  } catch (err) { next(err); }
});

// POST /grocery/items — add custom item
router.post('/items',
  [body('name').trim().notEmpty(), body('quantity').trim().notEmpty(), body('category').isIn(Object.values(GroceryCategory))],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      let list = await prisma.groceryList.findFirst({ where: { userId }, orderBy: { weekStart: 'desc' } });
      if (!list) list = await generateGroceryList(userId);

      const item = await prisma.groceryItem.create({
        data: {
          groceryListId: list.id,
          name: req.body.name, quantity: req.body.quantity,
          category: req.body.category, estimatedCost: req.body.estimatedCost,
          note: req.body.note,
        },
      });
      sendCreated(res, item, 'Item added');
    } catch (err) { next(err); }
  }
);

// PATCH /grocery/items/:itemId — toggle checked
router.patch('/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const item = await prisma.groceryItem.findUnique({
      where: { id: req.params.itemId },
      include: { groceryList: { select: { userId: true, id: true } } },
    });
    if (!item || item.groceryList.userId !== userId) { sendNotFound(res, 'Item not found'); return; }

    const updated = await prisma.groceryItem.update({
      where: { id: item.id },
      data: { checked: !item.checked, checkedAt: item.checked ? null : new Date() },
    });

    // Check if whole list is complete
    const remaining = await prisma.groceryItem.count({
      where: { groceryListId: item.groceryList.id, checked: false },
    });
    if (remaining === 0) await achievementService.checkGroceryAchievements(userId);

    sendSuccess(res, updated, updated.checked ? 'Item checked ✓' : 'Item unchecked');
  } catch (err) { next(err); }
});

// DELETE /grocery/items/:itemId
router.delete('/items/:itemId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const item = await prisma.groceryItem.findUnique({
      where: { id: req.params.itemId },
      include: { groceryList: { select: { userId: true } } },
    });
    if (!item || item.groceryList.userId !== userId) { sendNotFound(res, 'Item not found'); return; }
    await prisma.groceryItem.delete({ where: { id: item.id } });
    sendSuccess(res, null, 'Item removed');
  } catch (err) { next(err); }
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function generateGroceryList(userId: string, forceNew = false) {
  const today     = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);

  if (forceNew) {
    const old = await prisma.groceryList.findFirst({ where: { userId }, orderBy: { weekStart: 'desc' } });
    if (old) await prisma.groceryList.delete({ where: { id: old.id } });
  }

  const mealPlan = await prisma.mealPlan.findFirst({
    where: { userId, weekStart: { gte: weekStart } },
    include: { items: { include: { meal: true } } },
  });

  const meals = mealPlan?.items.map((i) => i.meal) ?? await prisma.meal.findMany({ where: { isActive: true }, take: 10 });

  type IngredientEntry = { quantity: string; category: GroceryCategory; cost: number };
  const ingredientMap: Record<string, IngredientEntry> = {};

  const RULES: Array<[string[], GroceryCategory, number]> = [
    [['avocado','tomato','broccoli','asparagus','greens','sweet potato','berry','berries','banana','lemon','spinach','salad','vegetable'], GroceryCategory.PRODUCE, 2.5],
    [['chicken','salmon','cod','beef','tuna','shrimp','protein powder','chickpea','lentil'], GroceryCategory.PROTEIN, 8],
    [['yogurt','milk','cheese','cream','butter','egg'], GroceryCategory.DAIRY_AND_EGGS, 3],
    [['quinoa','rice','bread','oat','pasta','granola','flour','sourdough'], GroceryCategory.GRAINS_AND_PANTRY, 3.5],
    [['almond','walnut','cashew','peanut butter','tahini','seed','nut'], GroceryCategory.NUTS_AND_SEEDS, 4],
    [['olive oil','honey','soy sauce','vinegar','herb','spice','salt','pepper','sauce','dressing'], GroceryCategory.CONDIMENTS_AND_OILS, 2],
    [['almond milk','oat milk','juice','water','tea','coffee'], GroceryCategory.BEVERAGES, 2],
  ];

  const classify = (ing: string): [GroceryCategory, number] => {
    const lower = ing.toLowerCase();
    for (const [keywords, cat, cost] of RULES) {
      if (keywords.some((k) => lower.includes(k))) return [cat, cost];
    }
    return [GroceryCategory.GRAINS_AND_PANTRY, 2];
  };

  meals.forEach((meal) => {
    meal.ingredients.forEach((ing) => {
      const key = ing.replace(/^\d+[\s\w]*\s/i, '').trim().toLowerCase();
      if (!key || ingredientMap[key]) return;
      const [category, cost] = classify(ing);
      ingredientMap[key] = { quantity: ing, category, cost };
    });
  });

  const list = await prisma.groceryList.create({
    data: {
      userId,
      mealPlanId: mealPlan?.id,
      weekStart,
      items: {
        create: Object.entries(ingredientMap).map(([name, { quantity, category, cost }], i) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          quantity, category, estimatedCost: cost, sortOrder: i,
        })),
      },
    },
    include: { items: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] } },
  });

  return list;
}

export default router;
