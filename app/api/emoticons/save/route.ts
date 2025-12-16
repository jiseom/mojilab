import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 환경 변수 체크
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Environment check:');
console.log('SUPABASE_URL:', SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SERVICE_ROLE_KEY:', SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables!');
}

// Service role key로 클라이언트 생성 (RLS 우회)
const supabaseAdmin = createClient(
  SUPABASE_URL!,
  SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function POST(request: NextRequest) {
  try {
    // 환경 변수 체크
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: 'Server configuration error: Missing environment variables',
          missing: {
            SUPABASE_URL: !SUPABASE_URL,
            SERVICE_ROLE_KEY: !SERVICE_ROLE_KEY
          }
        },
        { status: 500 }
      );
    }

    // 인증 토큰 검증
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, error: '인증이 필요합니다' },
        { status: 401 }
      );
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 인증입니다' },
        { status: 401 }
      );
    }

    const { modifiedImages, seriesId } = await request.json();

    // 시리즈 소유권 확인
    const { data: series, error: seriesError } = await supabaseAdmin
      .from('emoticon_series')
      .select('user_id')
      .eq('id', seriesId)
      .single();

    if (seriesError || !series) {
      return NextResponse.json(
        { success: false, error: '시리즈를 찾을 수 없습니다' },
        { status: 404 }
      );
    }

    if (series.user_id !== authUser.id) {
      return NextResponse.json(
        { success: false, error: '이 시리즈에 대한 권한이 없습니다' },
        { status: 403 }
      );
    }

    console.log(`💾 API: Saving ${modifiedImages.length} modified emoticons for series ${seriesId}`);

    const results = [];

    for (const { sceneId, imageData, name } of modifiedImages) {
      console.log(`\n📸 API: Processing scene: ${sceneId} (${name})`);

      // Base64를 Blob으로 변환
      const base64Data = imageData.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/png' });

      // Supabase Storage에 업로드
      const fileName = `emoticons/${seriesId}/${sceneId}_${Date.now()}.png`;
      console.log(`📤 API: Uploading to storage: ${fileName}`);

      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from('images')
        .upload(fileName, blob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        console.error(`❌ API: Upload failed for ${name}:`, uploadError);
        throw uploadError;
      }

      // Public URL 가져오기
      const { data: publicUrlData } = supabaseAdmin.storage
        .from('images')
        .getPublicUrl(fileName);

      const publicUrl = publicUrlData.publicUrl;
      console.log(`✅ API: Public URL: ${publicUrl}`);

      // 새로운 Scene인지 기존 Scene인지 확인
      const isNewScene = `new_scene_${Date.now()}`;

      if (isNewScene) {
        // 새로운 Scene INSERT
        console.log('📊 API: Fetching max scene_number...');
        const { data: existingScenes, error: fetchError } = await supabaseAdmin
          .from('emoticon_scenes')
          .select('scene_number')
          .eq('series_id', seriesId)
          .order('scene_number', { ascending: false })
          .limit(1);

        if (fetchError) {
          console.error('❌ API: Failed to fetch max scene_number:', fetchError);
          throw fetchError;
        }

        const maxSceneNumber = existingScenes?.[0]?.scene_number || 0;
        const newSceneNumber = maxSceneNumber + 1;

        console.log('💾 API: Inserting new scene into DB...');
        const { data: insertData, error: insertError } = await supabaseAdmin
          .from('emoticon_scenes')
          .insert({
            series_id: seriesId,
            scene_number: newSceneNumber,
            title: name,
            prompt: name || '편집된 이모티콘', // prompt 필드 추가 (NOT NULL 제약)
            image_url: publicUrl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          console.error(`❌ API: Failed to insert new scene ${name}:`, insertError);
          throw insertError;
        }

        console.log(`✅ API: Inserted new scene: ${name} (scene_number: ${newSceneNumber})`);
        results.push({ sceneId, action: 'inserted', data: insertData });
      } else {
        // 기존 Scene UPDATE
        console.log(`💾 API: Updating existing scene in DB (id: ${sceneId})...`);
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('emoticon_scenes')
          .update({
            image_url: publicUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sceneId)
          .select()
          .single();

        if (updateError) {
          console.error(`❌ API: Failed to update DB for ${name}:`, updateError);
          throw updateError;
        }

        console.log(`✅ API: Updated existing scene: ${name} (${sceneId})`);
        results.push({ sceneId, action: 'updated', data: updateData });
      }
    }

    console.log('🎉 API: All scenes saved successfully!');
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('❌ API: Save failed with error:', error);
    console.error('❌ Error type:', typeof error);
    console.error('❌ Error details:', JSON.stringify(error, null, 2));

    // 에러를 더 자세히 로깅
    if (error instanceof Error) {
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorType: typeof error,
        errorDetails: error
      },
      { status: 500 }
    );
  }
}
