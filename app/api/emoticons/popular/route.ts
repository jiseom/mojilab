import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '6');
    const category = searchParams.get('category'); // 카테고리 필터 (옵션)

    // 쿼리 빌더
    let query = supabase
      .from('emoticon_series')
      .select(`
        id,
        title,
        character_description,
        theme,
        created_at,
        user_id,
        categories,
        metadata
      `)
      .eq('is_public',true)
      .order('created_at', { ascending: false })
      .limit(limit);

    // 카테고리 필터 적용
    if (category && category !== 'all') {
      if (category === 'new') {
        // NEW: 7일 이내 생성된 것
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        query = query.gte('created_at', sevenDaysAgo.toISOString());
      } else if (category === 'popular') {
        // 인기: 현재는 최신순 (나중에 likes 기준)
        // 이미 최신순 정렬이므로 추가 처리 없음
      } else {
        // 특정 카테고리 필터
        query = query.contains('categories', [category]);
      }
    }

    const { data: series, error } = await query;

    if (error) {
      console.error('Series fetch error:', error);
      throw error;
    }

    // 각 시리즈의 첫 번째 이미지(썸네일) 가져오기
    const seriesWithThumbnails = await Promise.all(
      (series || []).map(async (s) => {
        // 해당 시리즈의 첫 번째 scene 가져오기
        const { data: scenes } = await supabase
          .from('emoticon_scenes')
          .select('image_url')
          .eq('series_id', s.id)
          .order('scene_number', { ascending: true })
          .limit(1);

        const thumbnail = scenes?.[0]?.image_url || null;

        return {
          id: s.id,
          title: s.title || `${s.character_description} - ${s.theme}`,
          thumbnail,
          author: '모지작가', // TODO: 실제 유저 닉네임 연동
          likes: Math.floor(Math.random() * 2000) + 100, // TODO: 실제 좋아요 수 연동
          isNew: isWithinDays(s.created_at, 7),
        };
      })
    );

    // 썸네일이 있는 것만 필터링
    const validSeries = seriesWithThumbnails.filter(s => s.thumbnail);

    return NextResponse.json({
      success: true,
      series: validSeries,
    });

  } catch (error: any) {
    console.error('Error fetching popular emoticons:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch popular emoticons' },
      { status: 500 }
    );
  }
}

// 날짜가 N일 이내인지 확인
function isWithinDays(dateString: string, days: number): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}
