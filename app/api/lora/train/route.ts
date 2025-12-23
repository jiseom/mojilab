import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { trainLoRA, LORA_TRAINING_CONFIG } from '@/lib/replicate-lora';
import { checkCredits, useCredit } from '@/lib/credits';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    // 환경변수 체크
    if (!process.env.NEXT_PUBLIC_APP_URL || !process.env.WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: '서버 설정 오류: 환경변수가 설정되지 않았습니다' },
        { status: 500 }
      );
    }

    // 인증 토큰 검증
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { error: '인증이 필요합니다' },
        { status: 401 }
      );
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authUser) {
      return NextResponse.json(
        { error: '유효하지 않은 인증입니다' },
        { status: 401 }
      );
    }

    const { name, images, userId } = await request.json();

    // userId와 인증된 사용자 일치 확인
    if (userId !== authUser.id) {
      return NextResponse.json(
        { error: '권한이 없습니다' },
        { status: 403 }
      );
    }

    // 1. 입력 검증
    if (!name || !images || !Array.isArray(images) || !userId) {
      return NextResponse.json(
        { error: '이름, 이미지, 사용자 ID가 필요합니다' },
        { status: 400 }
      );
    }

    if (images.length < LORA_TRAINING_CONFIG.minImages) {
      return NextResponse.json(
        { error: `최소 ${LORA_TRAINING_CONFIG.minImages}장의 이미지가 필요합니다` },
        { status: 400 }
      );
    }

    if (images.length > LORA_TRAINING_CONFIG.maxImages) {
      return NextResponse.json(
        { error: `최대 ${LORA_TRAINING_CONFIG.maxImages}장까지 업로드 가능합니다` },
        { status: 400 }
      );
    }

    // 2. 크레딧 확인
    const { hasEnough, current } = await checkCredits(userId, 'lora_credits');
    if (!hasEnough) {
      return NextResponse.json(
        { error: `LoRA 학습 크레딧이 부족합니다. 현재: ${current}` },
        { status: 402 }
      );
    }

    // 3. lora_models 레코드 생성
    const triggerWord = `STYLE_${Date.now().toString(36).toUpperCase()}`;

    const { data: loraModel, error: insertError } = await supabaseAdmin
      .from('lora_models')
      .insert({
        user_id: userId,
        name,
        trigger_word: triggerWord,
        status: 'pending',
        training_images_count: images.length,
      })
      .select()
      .single();

    if (insertError) {
      console.error('LoRA 모델 생성 실패:', insertError);
      return NextResponse.json(
        { error: '모델 생성에 실패했습니다: ' + insertError.message },
        { status: 500 }
      );
    }

    // 4. 이미지들을 ZIP 파일로 압축
    const zip = new JSZip();

    for (let i = 0; i < images.length; i++) {
      const imageData = images[i];
      // data:image/png;base64,xxxx 형식에서 base64 추출
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // 확장자 추출
      const mimeMatch = imageData.match(/^data:image\/(\w+);/);
      const ext = mimeMatch ? mimeMatch[1] : 'png';

      zip.file(`image_${i.toString().padStart(3, '0')}.${ext}`, buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 5. ZIP 파일을 Supabase Storage에 업로드
    const zipFileName = `lora-training/${userId}/${loraModel.id}/training_data.zip`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('images')
      .upload(zipFileName, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      console.error('ZIP 업로드 실패:', uploadError);
      // 실패 시 모델 삭제
      await supabaseAdmin.from('lora_models').delete().eq('id', loraModel.id);
      return NextResponse.json(
        { error: 'ZIP 파일 업로드에 실패했습니다' },
        { status: 500 }
      );
    }

    // 공개 URL 생성
    const { data: urlData } = supabaseAdmin.storage
      .from('images')
      .getPublicUrl(zipFileName);

    const trainingDataUrl = urlData.publicUrl;

    // 6. Replicate 학습 시작
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/lora/webhook?secret=${process.env.WEBHOOK_SECRET}`;
    const modelName = `style-${loraModel.id.slice(0, 8)}`;

    try {
      const { training, destination } = await trainLoRA({
        trainingDataUrl,
        triggerWord,
        // webhookUrl,
        modelName,
        description: `${name} - Custom LoRA style`,
      });

      // 7. 학습 ID 저장 및 상태 업데이트
      await supabaseAdmin
        .from('lora_models')
        .update({
          replicate_training_id: training.id,
          replicate_model_name: destination,//TODO: 변경필요
          status: 'training',
          training_started_at: new Date().toISOString(),
        })
        .eq('id', loraModel.id);

      // 8. 크레딧 차감
      await useCredit(userId, 'lora_credits');

      return NextResponse.json({
        success: true,
        modelId: loraModel.id,
        trainingId: training.id,
        status: 'training',
        message: '학습이 시작되었습니다. 10-20분 정도 소요됩니다.',
      });

    } catch (trainingError: any) {
      console.error('Replicate 학습 시작 실패:', trainingError);

      // 실패 시 모델 삭제 (롤백)
      await supabaseAdmin
        .from('lora_models')
        .delete()
        .eq('id', loraModel.id);

      // Storage에서 ZIP 파일도 삭제
      await supabaseAdmin.storage
        .from('images')
        .remove([zipFileName]);

      return NextResponse.json(
        { error: '학습 시작에 실패했습니다: ' + trainingError.message },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('LoRA 학습 API 오류:', error);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다: ' + error.message },
      { status: 500 }
    );
  }
}
