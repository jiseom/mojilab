import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface GenerateScenesRequest {
  character: string;
  theme: string;
}

const SCENE_COUNT = 5; // Vercel 타임아웃 대응 (원래 32)

// 테마를 장면으로 분해하는 함수
async function breakThemeIntoScenes(theme: string, character: string): Promise<string[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const prompt = `You are creating ${SCENE_COUNT} emoticon scenes for a character based on a theme.

Character: ${character}
Theme: ${theme}

Create ${SCENE_COUNT} DIVERSE and VARIED POSE DESCRIPTIONS with SPECIFIC body movements that represent this theme.

CRITICAL REQUIREMENTS:
- Each pose MUST be COMPLETELY DIFFERENT from others
- Mix VARIOUS pose types: standing, sitting, lying, jumping, running, leaning, bending, stretching, etc.
- Include DIVERSE angles: front, side, back, diagonal

Each pose MUST include:
- SPECIFIC ARM positions (양손을 머리 위로, 한 손 들고, 팔을 벌리고, 팔짱 끼고 등)
- SPECIFIC LEG positions (앉아서, 엎드려, 누워서, 뛰면서, 한 발로 서서 등)
- BODY ANGLE details (뒤로 젖혀, 옆으로 누워, 뒤돌아보며, 앞으로 숙여 등)
- Related to the theme
- Expressed in detailed Korean descriptions

Format: Return ONLY ${SCENE_COUNT} lines, each describing one DETAILED POSE in Korean.
DO NOT follow any fixed pattern. Be creative and think outside the box based on the theme.

Now generate ${SCENE_COUNT} DETAILED POSE DESCRIPTIONS for the given theme in Korean:`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  const scenes = text
    .split('\n')
    .map(line => line.replace(/^\d+\.?\s*/, '').trim()) // 숫자 제거
    .filter(line => line.length > 0)
    .slice(0, SCENE_COUNT);

  console.log(`Generated ${scenes.length} scenes for theme: ${theme}`);
  console.log('Scenes:', scenes);

  if (scenes.length < SCENE_COUNT) {
    throw new Error(`Only generated ${scenes.length} scenes, need ${SCENE_COUNT}`);
  }

  return scenes;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateScenesRequest = await request.json();
    const { character, theme } = body;

    if (!character || !theme) {
      return NextResponse.json(
        { error: 'Missing required fields: character, theme' },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not configured' },
        { status: 500 }
      );
    }

    const displayTheme = theme.length > 50 ? theme.substring(0, 50) + '...' : theme;
    console.log(`Generating ${SCENE_COUNT} scenes for theme: "${displayTheme}"`);

    const scenes = await breakThemeIntoScenes(theme, character);

    return NextResponse.json({
      success: true,
      scenes,
      character,
      theme,
    });

  } catch (error: any) {
    console.error('Error generating scenes:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to generate scenes',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
