import { NextRequest, NextResponse } from 'next/server';
import Replicate from 'replicate';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN || '',
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Supabase client for direct DB save
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

async function resolveReplicateModelById(id: string): Promise<string> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('lora_models')
    .select('replicate_model_name')
    .eq('id', id)
    .single();

  if (error || !data?.replicate_model_name) {
    throw new Error(`Invalid model id: ${id}`);
  }
  return data.replicate_model_name as string;
}



interface ConvertRequest {
  id?: string;
  images?: string[]; // base64 data URLs (optional - img2img mode)
  prompts?: string[]; // text prompts (optional - text2img mode)
  mode?: 'text2img' | 'img2img' | 'preview' | 'batch'; // generation mode
  style?: 'pencil' | 'pen'; // style variant (for sketch page)
  theme?: string; // theme for emotion generation (for sketch page)
  referenceImage?: string; // reference image for batch mode (for character consistency)
  monochromeOnly?: boolean; // 흑백 전용 옵션 (기본값: true)
  // 자동 저장 옵션
  saveToDb?: boolean; // true면 생성 완료 후 자동으로 DB에 저장
  userId?: string; // 저장시 필요한 사용자 ID
  character?: string; // 저장시 필요한 캐릭터 설명
  emotionNames?: string[]; // 각 이미지의 감정 이름 (prompts와 1:1 매칭)
}

// 스타일별 프롬프트 템플릿
const STYLE_PROMPTS = {
  pencil: `soft pencil sketch, light graphite strokes, gentle pencil shading, delicate line art, thin sketchy lines, subtle pencil texture, hand-drawn with soft strokes, loose pencil drawing, light sketchy style, faint outlines`,
  pen: `VERY BOLD thick black marker pen, EXTREMELY STRONG ink outlines, HEAVY black borders, THICK chunky pen strokes, bold cartoon style, SOLID black lines, confident bold ink drawing, thick marker technique, HEAVY pen pressure, STRONG contrast, clean bold style`
};

// 카테고리 목록
const VALID_CATEGORIES = ['cute', 'daily', 'work', 'love', 'funny', 'animal', 'food', 'seasonal'] as const;

// 테마/캐릭터에서 카테고리 자동 분류 (Gemini 사용)
async function classifyCategories(theme: string, character: string): Promise<string[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `Classify this emoticon theme and character into categories.

Theme: ${theme}
Character: ${character}

Available categories:
- cute: 귀여운, 사랑스러운 캐릭터
- daily: 일상, 생활, 백수, 집순이, 집돌이, 휴식
- work: 직장, 회사, 업무, 출근, 퇴근
- love: 연애, 사랑, 커플, 썸
- funny: 웃긴, 유머, 개그
- animal: 동물 캐릭터 (고양이, 강아지, 토끼 등)
- food: 음식, 먹방, 요리
- seasonal: 계절, 명절, 크리스마스, 설날, 추석, 여름, 겨울

Return ONLY a JSON array of matching category slugs (1-3 categories).
Example: ["cute", "animal"]

Categories:`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // JSON 파싱
    const match = text.match(/\[.*\]/);
    if (match) {
      const categories = JSON.parse(match[0]) as string[];
      // 유효한 카테고리만 필터링
      return categories.filter(c => VALID_CATEGORIES.includes(c as any));
    }

    return ['daily']; // 기본값
  } catch (error) {
    console.error('Category classification failed:', error);
    return ['daily']; // 실패 시 기본값
  }
}

// 캐릭터 설명을 영어로 번역 (캐시 사용)
const translationCache = new Map<string, string>();

async function translateToEnglish(text: string): Promise<string> {
  // 캐시 확인
  if (translationCache.has(text)) {
    console.log(`Using cached translation for: "${text}"`);
    return translationCache.get(text)!;
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `Translate this character description to English for AI image generation.
Keep it concise and clear. Only output the English translation, nothing else.

Korean: ${text}
English:`;

    const result = await model.generateContent(prompt);
    const translation = result.response.text().trim();

    console.log(`Translation: "${text}" → "${translation}"`);

    // 캐시 저장
    translationCache.set(text, translation);

    return translation;
  } catch (error) {
    console.error('Translation failed:', error);
    // 번역 실패시 원본 반환
    return text;
  }
}

// 투명 배경을 흰색으로 변환하는 헬퍼 함수
async function convertTransparentToWhite(dataUrl: string): Promise<string> {
  try {
    // data URL에서 base64 데이터 추출
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // 흰색 배경으로 합성
    const processedBuffer = await sharp(imageBuffer)
      .flatten({ background: { r: 255, g: 255, b: 255 } }) // 투명 → 흰색
      .png()
      .toBuffer();

    // base64로 다시 변환
    const processedBase64 = processedBuffer.toString('base64');
    return `data:image/png;base64,${processedBase64}`;
  } catch (error) {
    console.error('Error converting transparent background:', error);
    // 변환 실패시 원본 반환
    return dataUrl;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ConvertRequest = await request.json();
    const {
      id,
      images, prompts, mode = 'text2img', style, theme, referenceImage, monochromeOnly = true,
      saveToDb = false, userId, character, emotionNames
    } = body;

    // mode 정규화: preview/batch → text2img
    const actualMode = mode === 'preview' || mode === 'batch' ? 'text2img' : mode;
    const isPreviewMode = mode === 'preview';
    const isBatchMode = mode === 'batch';

    // 모드에 따라 유효성 검사
    if (mode === 'img2img' && (!images || !Array.isArray(images) || images.length === 0)) {
      return NextResponse.json(
        { error: 'Missing required field for img2img mode: images (array of base64 data URLs)' },
        { status: 400 }
      );
    }

    if ((actualMode === 'text2img' || isPreviewMode || isBatchMode) && (!prompts || !Array.isArray(prompts) || prompts.length === 0)) {
      return NextResponse.json(
        { error: 'Missing required field for text2img/preview/batch mode: prompts (array of text prompts)' },
        { status: 400 }
      );
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json(
        { error: 'REPLICATE_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    const isText2Img = actualMode === 'text2img';
    const itemCount = isText2Img ? prompts!.length : images!.length;

    console.log(`Generating ${itemCount} images with FLUX LoRA (${mode} mode${style ? `, style: ${style}` : ''}${theme ? `, theme: ${theme}` : ''})...`);

    let modelName: string | null = null;

    if (!id) {
      return NextResponse.json(
      { error: 'model id is required' },
      { status: 400 }
     );
    }

    // id가 있으면 반드시 resolve
    const model = await resolveReplicateModelById(id);
    	
    const results = [];

    // 이미지/프롬프트를 순차적으로 생성 (rate limit 회피)
    for (let i = 0; i < itemCount; i++) {
      const startTime = Date.now();

      console.log(`Generating ${i + 1}/${itemCount} (${mode})...`);

      try {
        let inputParams: any = {
          model: 'dev',
          go_fast: false,
          lora_scale: 1,
          megapixels: '1',
          num_outputs: 1,
          aspect_ratio: '1:1',
          output_format: 'webp',
          guidance_scale: 3,
          output_quality: 80,
          extra_lora_scale: 1,
          num_inference_steps: 28,
        };

        if (isText2Img) {
          // text2img 모드: 2단계 프로세스 (생성 → 정제)
          let userPrompt = prompts![i];

          // 영어로 번역
          const translatedPrompt = await translateToEnglish(userPrompt);

          // 테마가 있으면 프롬프트에 추가
          let finalPrompt = translatedPrompt;
          if (theme && isBatchMode) {
            const translatedTheme = await translateToEnglish(theme);
            finalPrompt = `${translatedPrompt}, in context of ${translatedTheme}`;
          }

          // 스타일별 프롬프트 적용
          const stylePrefix = style ? STYLE_PROMPTS[style] + ', ' : 'hand-drawn sketch with marker pen strokes, pencil texture, rough line art style, thick uneven marker lines, casual pencil shading, sketchy stroke-based drawing, ';

          // 흑백 vs 컬러 프롬프트
          const colorPrompt = monochromeOnly
            ? 'black and white only, grayscale shading, NO colors, monochrome line art, pencil hatching for shadows, simple gray tones, NO blush, NO blushing'
            : 'colorful, vibrant colors, soft pastel tones';

          const fullPrompt = `${finalPrompt}, ${stylePrefix}strong black outlines, bold black borders, thick black contour lines, clear black edges, ${colorPrompt}, chibi proportions with slightly bigger head, compact body, very short stubby limbs, small arms and legs, NO tall body, NO long limbs, asymmetric wonky proportions, crooked uneven features, lopsided asymmetric face, simple flat dash eyes (- -) or simple dot eyes (• •), NO round eyes, NO circular pupils, NO eyeballs, NO shiny eyes, absolutely NO long tail, short stubby tail only or no tail, imperfect hand-drawn shapes, loose strokes, white background`;

          // Step 1: text2img 생성
          inputParams.prompt = fullPrompt;

          console.log(`  → Step 1/2: text2img generation with prompt: "${userPrompt}" → "${translatedPrompt}"${style ? ` (${style} style)` : ''}${theme && isBatchMode ? ` [theme: ${theme}]` : ''}`);
          console.log(`  → Starting Step 1...`);
        } else {
          // img2img 모드: 이미지 + 프롬프트
          const imageDataUrl = images![i];
          const whiteBackgroundImage = await convertTransparentToWhite(imageDataUrl);

          // 프롬프트가 있으면 사용 (img2img 모드에서 각 감정별 프롬프트)
          let finalPrompt = '';
          if (prompts && prompts[i]) {
            const userPrompt = prompts[i];

            // 영어로 번역
            const translatedPrompt = await translateToEnglish(userPrompt);

            // 테마가 있으면 프롬프트에 추가
            if (theme) {
              const translatedTheme = await translateToEnglish(theme);
              finalPrompt = `${translatedPrompt}, in context of ${translatedTheme}`;
            } else {
              finalPrompt = translatedPrompt;
            }

            console.log(`  → Translated prompt: "${userPrompt}" → "${translatedPrompt}"`);
          }

          // 스타일별 프롬프트 적용
          const stylePrefix = style ? STYLE_PROMPTS[style] + ', ' : 'rough doodle sketch, messy hand-drawn lines, sketchy unpolished style, ';

          // 흑백 vs 컬러 프롬프트 (img2img)
          const colorPromptImg = monochromeOnly
            ? 'black and white only, grayscale shading, NO colors, monochrome line art, pencil hatching for shadows, simple gray tones, NO blush, NO blushing'
            : 'colorful, vibrant colors, soft pastel tones';

          const stylePrompt = finalPrompt
            ? `${finalPrompt}, ${stylePrefix}strong black outlines, bold black borders, thick black contour lines, clear black edges, ${colorPromptImg}, chibi proportions with slightly bigger head, compact body, very short stubby limbs, small arms and legs, NO tall body, NO long limbs, with small simple flat eyes (NO sparkling or shining eyes, NO round pupils), asymmetric crooked face shape, wonky irregular proportions, imperfect shapes, casual drawing, loose strokes, absolutely NO long tail, short stubby tail only or no tail, white background`
            : `${stylePrefix}strong black outlines, bold black borders, thick black contour lines, clear black edges, ${colorPromptImg}, chibi proportions with slightly bigger head, compact body, very short stubby limbs, small arms and legs, NO tall body, NO long limbs, with small simple flat eyes (NO sparkling or shining eyes, NO round pupils), asymmetric crooked face shape, wonky irregular proportions, imperfect shapes, casual drawing, loose strokes, white background`;

          inputParams.image = whiteBackgroundImage;
          inputParams.prompt = stylePrompt;
          inputParams.prompt_strength = 0.25; // 매우 낮은 강도로 포즈 완전 재작성
          console.log(`  → Converting image with img2img (strength: 0.25)${finalPrompt ? ` (prompt: "${finalPrompt}")` : ''}${style ? ` (${style} style)` : ''}`);
        }

        const output = await replicate.run(model as any, { input: inputParams });
        console.log(`  ✅ Step 1 complete`);

        let imageUrl: string;

        if (Array.isArray(output)) {
          imageUrl = String(output[0]);
        } else if (typeof output === 'string') {
          imageUrl = output;
        } else if (output && typeof output === 'object') {
          const urlField = (output as any).url || (output as any).output || (output as any)[0];
          if (urlField) {
            imageUrl = String(urlField);
          } else {
            throw new Error('Cannot find URL in output object');
          }
        } else {
          throw new Error('Invalid output format: ' + typeof output);
        }

        if (typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
          throw new Error('Invalid URL returned from Replicate');
        }

        let finalUrl = imageUrl;

        // text2img 모드인 경우: Step 2로 img2img 정제 실행 (캐릭터 일관성)
        // - preview 모드: 스킵 (1-pass만)
        // - batch 모드: Step 1 결과를 정제하여 LoRA 스타일 일관성 추가
        // - 일반 text2img: 같은 이미지로 self-refinement
        if (isText2Img && !isPreviewMode) {
          // Step 1과 Step 2 사이에 대기 (rate limit)
          console.log(`  → Waiting 15s before Step 2 (rate limit: 6/min)...`);
          await new Promise(resolve => setTimeout(resolve, 15000));

          console.log(`  → Step 2/2: img2img refinement (keeping pose from Step 1)`);

          // Step 2는 항상 Step 1 결과를 기반으로 정제
          const step2Output = await replicate.run(model as any, {
            input: {
              image: imageUrl, // Step 1 결과 사용 (포즈 유지)
              prompt: inputParams.prompt, // 같은 프롬프트
              model: 'dev',
              go_fast: false,
              lora_scale: 1,
              megapixels: '1',
              num_outputs: 1,
              aspect_ratio: '1:1',
              output_format: 'webp',
              guidance_scale: 3,
              output_quality: 80,
              prompt_strength: 0.3, // 낮은 강도로 포즈는 그대로, LoRA 스타일만 정제
              extra_lora_scale: 1,
              num_inference_steps: 28,
            },
          });

          // Step 2 결과 추출
          if (Array.isArray(step2Output)) {
            finalUrl = String(step2Output[0]);
          } else if (typeof step2Output === 'string') {
            finalUrl = step2Output;
          } else if (step2Output && typeof step2Output === 'object') {
            const urlField = (step2Output as any).url || (step2Output as any).output || (step2Output as any)[0];
            if (urlField) {
              finalUrl = String(urlField);
            }
          }

          console.log(`  ✅ Step 2 complete: ${finalUrl}`);
        }

        const convertedUrl = finalUrl;

        // 배경 제거는 일단 스킵 (흰 배경 그대로 다운로드)
        console.log(`  → Skipping background removal (returning original)...`);
        let transparentDataUrl: string | null = null;

        try {
          // 원본 이미지를 PNG로 변환만
          const imageResponse = await fetch(convertedUrl);
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

          // 360x360 리사이즈
          const resizedBuffer = await sharp(imageBuffer)
            .resize(360, 360, {
              fit: 'contain',
              background: { r: 255, g: 255, b: 255 } // 흰색 배경
            })
            .png()
            .toBuffer();

          transparentDataUrl = `data:image/png;base64,${resizedBuffer.toString('base64')}`;
          console.log(`  ✅ PNG conversion complete (white background)`);
        } catch (error: any) {
          console.error(`  ⚠️ PNG conversion failed:`, error.message);
        }

        const elapsedTime = Date.now() - startTime;
        console.log(`✅ ${mode} ${i + 1}/${itemCount} complete (took ${(elapsedTime / 1000).toFixed(1)}s):`, convertedUrl);

        results.push({
          index: i,
          ...(isText2Img ? { prompt: prompts![i] } : { originalDataUrl: images![i] }),
          generatedUrl: convertedUrl,
          transparentDataUrl, // 투명 배경 버전
          success: true,
        });

      } catch (error: any) {
        console.error(`❌ Failed to generate ${i + 1}:`, error.message);

        results.push({
          index: i,
          ...(isText2Img ? { prompt: prompts![i] } : { originalDataUrl: images![i] }),
          generatedUrl: null,
          success: false,
          error: error.message,
        });
      }

      // rate limit: 6/min = 다음 프롬프트 전 무조건 대기
      if (i < itemCount - 1) {
        // preview 모드는 더 짧은 대기 (1-pass만 하므로)
        const waitTime = isPreviewMode ? 2000 : 15000;
        console.log(`⏳ Waiting ${waitTime / 1000}s before next prompt (rate limit: 6/min)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ Generation complete: ${successCount}/${itemCount} successful`);

    // 자동 저장 옵션이 활성화되면 DB에 바로 저장
    let savedSeriesId: string | null = null;
    if (saveToDb && userId && character && successCount > 0) {
      console.log(`📦 Auto-saving to DB (userId: ${userId}, character: ${character})...`);

      try {
        const supabase = getSupabaseClient();

        // 0. 카테고리 자동 분류
        const categories = await classifyCategories(theme || '', character);
        console.log(`📂 Classified categories: ${categories.join(', ')}`);

        // 1. emoticon_series 생성
        const { data: series, error: seriesError } = await supabase
          .from('emoticon_series')
          .insert({
            user_id: userId,
            theme: theme || 'Custom Sketch',
            title: `${character} - ${theme || 'Sketch'}`,
            character_description: character,
            num_scenes: successCount,
            categories, // 카테고리 배열 저장
            metadata: {
              style: style || 'pen',
              generation_method: 'pro_flux_lora',
              created_from: 'pro',
              monochromeOnly,
            },
          })
          .select()
          .single();

        if (seriesError) {
          console.error('Series creation error:', seriesError);
          throw seriesError;
        }

        savedSeriesId = series.id;

        // 2. 성공한 이미지들만 저장
        const successfulResults = (results as any[]).filter(r => r.success && r.transparentDataUrl);

        // Storage 업로드 (병렬) + scene 레코드 수집 (개별 실패 허용)
        const sceneRecords: any[] = [];

        await Promise.all(successfulResults.map(async (result, idx) => {
          try {
            const dataUrl = result.transparentDataUrl!;
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // 감정 이름: emotionNames 배열에서 가져오거나 prompts에서 가져옴
            const emotionName = emotionNames?.[result.index] || prompts?.[result.index] || `Scene ${idx + 1}`;

            const fileName = `emoticons/${series.id}/scene_${result.index}.png`;
            const { error: uploadError } = await supabase.storage
              .from('images')
              .upload(fileName, buffer, {
                contentType: 'image/png',
                upsert: true,
              });

            if (uploadError) {
              console.error(`Upload error for scene ${result.index}:`, uploadError);
              return; // 이 이미지만 스킵, 나머지 계속 진행
            }

            const { data: urlData } = supabase.storage
              .from('images')
              .getPublicUrl(fileName);

            // 레코드 수집 (나중에 다건 insert)
            sceneRecords.push({
              series_id: series.id,
              scene_number: result.index,
              title: emotionName,
              narrative: '',
              prompt: `${character} - ${emotionName}`,
              image_url: urlData.publicUrl,
              metadata: {
                original_style: style || 'pen',
                monochromeOnly,
              },
            });
          } catch (err: any) {
            console.error(`Failed to save scene ${result.index}:`, err.message);
            // 개별 실패는 무시하고 계속 진행
          }
        }));

        // 다건 insert (한 번에) - 성공한 것들만
        if (sceneRecords.length > 0) {
          const { error: scenesError } = await supabase
            .from('emoticon_scenes')
            .insert(sceneRecords);

          if (scenesError) {
            console.error('Scenes bulk insert error:', scenesError);
            // DB insert 실패해도 이미지 생성 결과는 반환
          }
        }

        console.log(`✅ Auto-save complete: series ${savedSeriesId}, ${sceneRecords.length}/${successfulResults.length} scenes saved`);

      } catch (saveError: any) {
        console.error('Auto-save failed:', saveError.message);
        // 저장 실패해도 생성 결과는 반환
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      results,
      total: itemCount,
      successCount,
      failedCount: itemCount - successCount,
      savedSeriesId, // 저장된 경우 series ID 반환
    });

  } catch (error: any) {
    console.error('Error converting images with FLUX LoRA:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to convert images',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
