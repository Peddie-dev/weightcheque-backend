import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../../middleware/auth';
import { sendBadRequest, sendSuccess } from '../../utils/response';

const router = Router();
router.use(authenticate);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /meals/scan
// Body: { image: base64string, mimeType: 'image/jpeg' | 'image/png' }
router.post(
  '/scan',
  [
    body('image').notEmpty().isString(),
    body('mimeType').optional().isIn(['image/jpeg', 'image/png', 'image/webp']),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { image, mimeType = 'image/jpeg' } = req.body;

      if (!image) {
        sendBadRequest(res, 'Image is required');
        return;
      }

      const message = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
                  data: image,
                },
              },
              {
                type: 'text',
                text: `Analyze this food image and provide nutritional information.
                
Return ONLY a valid JSON object with no markdown, no explanation, no extra text. Just the raw JSON.

The JSON must have this exact structure:
{
  "foodName": "name of the food or meal",
  "description": "brief one-line description",
  "confidence": "high" | "medium" | "low",
  "servingSize": "estimated serving size e.g. 1 plate, 200g",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "ingredients": ["ingredient1", "ingredient2"],
  "healthScore": number between 1-10,
  "notes": "any relevant dietary notes e.g. high sodium, good source of iron"
}

All numeric values should be per serving. If you cannot identify food in the image, return:
{ "error": "Could not identify food in this image" }`,
              },
            ],
          },
        ],
      });

      const raw = message.content[0].type === 'text' ? message.content[0].text : '';

      // Strip any accidental markdown fences
      const cleaned = raw.replace(/```json|```/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        sendBadRequest(res, 'Could not parse food analysis. Please try again.');
        return;
      }

      if (parsed.error) {
        sendBadRequest(res, parsed.error);
        return;
      }

      sendSuccess(res, parsed, 'Food scanned successfully');
    } catch (err) {
      next(err);
    }
  }
);

export default router;