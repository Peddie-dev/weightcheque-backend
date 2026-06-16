import { PrismaClient, MealType, DietType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Achievements ────────────────────────────────────────────────────────────
  const achievements = [
    { key: 'first_login',       title: 'Welcome!',            description: 'Created your account',              icon: '👋', condition: { type: 'login_count', value: 1 } },
    { key: 'first_meal_logged', title: 'First Bite',          description: 'Logged your first meal',            icon: '🍽️', condition: { type: 'meal_log_count', value: 1 } },
    { key: 'first_3kg_lost',    title: 'First 3 kg Lost',     description: 'Lost your first 3 kg',              icon: '🏋️', condition: { type: 'weight_lost', value: 3 } },
    { key: 'streak_7',          title: '7-Day Consistency',   description: 'Logged meals 7 days in a row',      icon: '🎯', condition: { type: 'streak', value: 7 } },
    { key: 'streak_30',         title: '30-Day Champion',     description: 'Logged meals 30 days in a row',     icon: '🏆', condition: { type: 'streak', value: 30 } },
    { key: 'weight_goal',       title: 'Goal Reached!',       description: 'Reached your target weight',        icon: '🎉', condition: { type: 'weight_goal_reached', value: true } },
    { key: 'water_week',        title: 'Hydration Hero',      description: 'Hit water goal 7 days in a row',    icon: '💧', condition: { type: 'water_streak', value: 7 } },
    { key: 'grocery_complete',  title: 'Savvy Shopper',       description: 'Completed a full grocery list',     icon: '🛒', condition: { type: 'grocery_complete', value: true } },
  ];

  for (const a of achievements) {
    await prisma.achievement.upsert({ where: { key: a.key }, update: {}, create: a });
  }
  console.log(`✅ ${achievements.length} achievements`);

  // ── Meals ────────────────────────────────────────────────────────────────────
  const meals = [
    {
      id: 'avocado_eggs',
      name: 'Avocado & Eggs',
      type: MealType.BREAKFAST,
      kcal: 350, protein: 15, carbs: 10, fats: 25, fiber: 7, sugar: 1,
      imageUrl: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800',
      ingredients: ['2 Eggs', '1 Avocado', '1 slice sourdough', 'Salt & pepper'],
      instructions: ['Cook the eggs to your liking.', 'Slice the avocado and serve on toast.', 'Season and enjoy.'],
      tags: ['high-fat', 'keto-friendly', 'quick'],
      dietTypes: [DietType.STANDARD, DietType.VEGETARIAN, DietType.KETO],
      allergens: ['eggs', 'gluten'],
      prepTimeMins: 10,
    },
    {
      id: 'chicken_salad',
      name: 'Grilled Chicken Salad',
      type: MealType.LUNCH,
      kcal: 550, protein: 42, carbs: 18, fats: 14, fiber: 4, sugar: 3,
      imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800',
      ingredients: ['150g chicken breast', 'Mixed greens', 'Cherry tomatoes', 'Olive oil dressing'],
      instructions: ['Season and grill chicken 6-8 min each side.', 'Slice and serve over greens.', 'Drizzle dressing.'],
      tags: ['high-protein', 'low-carb'],
      dietTypes: [DietType.STANDARD, DietType.PALEO, DietType.MEDITERRANEAN],
      allergens: [],
      prepTimeMins: 20,
    },
    {
      id: 'salmon_veggies',
      name: 'Salmon & Veggies',
      type: MealType.DINNER,
      kcal: 600, protein: 38, carbs: 30, fats: 20, fiber: 6, sugar: 5,
      imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800',
      ingredients: ['200g salmon fillet', 'Broccoli', 'Sweet potato', 'Lemon', 'Herbs'],
      instructions: ['Preheat oven to 200°C.', 'Season salmon with herbs.', 'Roast with vegetables 20 min.'],
      tags: ['omega-3', 'balanced'],
      dietTypes: [DietType.STANDARD, DietType.PALEO, DietType.MEDITERRANEAN],
      allergens: ['fish'],
      prepTimeMins: 25,
    },
    {
      id: 'greek_yogurt_bowl',
      name: 'Greek Yogurt Bowl',
      type: MealType.BREAKFAST,
      kcal: 280, protein: 18, carbs: 32, fats: 6, fiber: 3, sugar: 18,
      imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800',
      ingredients: ['200g Greek yogurt', 'Mixed berries', 'Honey', 'Granola'],
      instructions: ['Layer yogurt in bowl.', 'Top with berries and granola.', 'Drizzle honey.'],
      tags: ['probiotic', 'quick', 'high-protein'],
      dietTypes: [DietType.STANDARD, DietType.VEGETARIAN],
      allergens: ['dairy', 'gluten', 'nuts'],
      prepTimeMins: 5,
    },
    {
      id: 'quinoa_bowl',
      name: 'Quinoa Power Bowl',
      type: MealType.LUNCH,
      kcal: 480, protein: 22, carbs: 58, fats: 12, fiber: 8, sugar: 4,
      imageUrl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800',
      ingredients: ['150g quinoa', 'Roasted veggies', 'Chickpeas', 'Tahini'],
      instructions: ['Cook quinoa.', 'Roast veggies at 200°C.', 'Assemble and drizzle tahini.'],
      tags: ['plant-protein', 'vegan'],
      dietTypes: [DietType.STANDARD, DietType.VEGETARIAN, DietType.VEGAN, DietType.MEDITERRANEAN],
      allergens: ['sesame'],
      prepTimeMins: 30,
    },
    {
      id: 'almonds_snack',
      name: 'Almonds',
      type: MealType.SNACKS,
      kcal: 170, protein: 6, carbs: 6, fats: 15, fiber: 3, sugar: 1,
      imageUrl: 'https://images.unsplash.com/photo-1508061-6b8ce27dbdba?w=800',
      ingredients: ['30g raw almonds'],
      instructions: ['Portion and enjoy.'],
      tags: ['portable', 'keto-friendly'],
      dietTypes: [DietType.STANDARD, DietType.VEGETARIAN, DietType.VEGAN, DietType.KETO, DietType.PALEO],
      allergens: ['nuts'],
      prepTimeMins: 0,
    },
  ];

  for (const meal of meals) {
    await prisma.meal.upsert({ where: { id: meal.id }, update: {}, create: meal });
  }
  console.log(`✅ ${meals.length} meals`);

  // ── Demo user ─────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);
  const demo = await prisma.user.upsert({
    where: { email: 'henry@weightcheque.com' },
    update: {},
    create: {
      email: 'henry@weightcheque.com',
      passwordHash,
      name: 'Henry',
      isEmailVerified: true,
      profile: {
        create: {
          goalType: 'LOSE_WEIGHT',
          startWeight: 84,
          currentWeight: 80,
          targetWeight: 70,
          height: 178,
          activityLevel: 'MODERATE',
          dietType: 'STANDARD',
          mealsPerDay: 3,
          dailyKcalGoal: 1800,
          dailyWaterGoal: 2.5,
          streak: 5,
        },
      },
    },
  });
  console.log(`✅ Demo user: ${demo.email} / password123`);
  console.log('🎉 Seed complete!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
