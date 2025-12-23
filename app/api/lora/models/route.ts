import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: 유저의 LoRA 모델 목록 조회
export async function GET(request: NextRequest) {
  try {
    // 인증 토큰 검증
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { error: '인증이 필요합니다' },
        { status: 401 }
      );
    }

    // 토큰에서 사용자 정보 추출
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: '유효하지 않은 인증입니다' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // 선택적 필터

    // 요청한 userId와 인증된 사용자가 일치하는지 확인
    if (userId && userId !== user.id) {
      return NextResponse.json(
        { error: '권한이 없습니다' },
        { status: 403 }
      );
    }

    // userId 파라미터 없으면 본인 ID 사용
    const targetUserId = userId || user.id;

    let query = supabaseAdmin
      .from('lora_models')
      .select('id,name,training_images_count,status')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    // 상태 필터 적용
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('LoRA 모델 조회 실패:', error);
      return NextResponse.json(
        { error: '모델 조회에 실패했습니다' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      models: data || [],
      count: data?.length || 0,
    });

  } catch (error: any) {
    console.error('LoRA 모델 목록 API 오류:', error);
    return NextResponse.json(
      { error: '서버 오류: ' + error.message },
      { status: 500 }
    );
  }
}

// POST: 새 모델 생성 (train API에서 처리하므로 여기서는 사용 안 함)
export async function POST(request: NextRequest) {
  return NextResponse.json(
    { error: '/api/lora/train을 사용하세요' },
    { status: 405 }
  );
}
