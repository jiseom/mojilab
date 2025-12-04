'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import ImageEditor from '@/components/image-editor/ImageEditor';
import { useEffect, useState, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Lock } from 'lucide-react';

interface Scene {
  id: string;
  scene_number: number;
  title: string;
  image_url: string;
}

function EditorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(false);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  useEffect(() => {
    // URL 파라미터에서 캔버스 크기 가져오기
    const width = searchParams.get('width');
    const height = searchParams.get('height');
    const series = searchParams.get('seriesId');

    if (width && height) {
      setDimensions({
        width: parseInt(width, 10),
        height: parseInt(height, 10),
      });
    }

    // 시리즈 ID 설정
    if (series) {
      setSeriesId(series);
    }
  }, [searchParams]);

  // 소유권 확인 및 장면 로드
  useEffect(() => {
    if (seriesId && user && !authLoading) {
      checkOwnershipAndFetchScenes(seriesId);
    }
  }, [seriesId, user, authLoading]);

  const checkOwnershipAndFetchScenes = async (seriesId: string) => {
    setLoading(true);
    try {
      // 시리즈 소유권 확인
      const { data: series, error: seriesError } = await supabase
        .from('emoticon_series')
        .select('user_id')
        .eq('id', seriesId)
        .single();

      if (seriesError) throw seriesError;

      if (series.user_id !== user?.id) {
        setIsOwner(false);
        return;
      }

      setIsOwner(true);

      // 소유자인 경우에만 장면 로드
      const { data, error } = await supabase
        .from('emoticon_scenes')
        .select('id, scene_number, title, image_url')
        .eq('series_id', seriesId)
        .order('scene_number');

      if (error) throw error;

      setScenes(data || []);
    } catch (error) {
      console.error('Error fetching scenes:', error);
      alert('이모티콘을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (imageDataJson: string) => {
    console.log('🚀 handleSave started');
    console.log('📦 Received JSON length:', imageDataJson.length);

    try {
      // JSON 파싱하여 변경된 이모티콘 목록 가져오기
      const modifiedImages: { sceneId: string; imageData: string; name: string }[] = JSON.parse(imageDataJson);

      console.log(`💾 Saving ${modifiedImages.length} modified emoticons...`);
      console.log('📋 Modified scenes:', modifiedImages.map(img => ({ sceneId: img.sceneId, name: img.name })));

      // 인증 토큰 가져오기
      const { data: { session } } = await supabase.auth.getSession();

      // API 라우트로 저장 요청 (RLS 우회)
      console.log('📡 Calling API route...');
      const response = await fetch('/api/emoticons/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          modifiedImages,
          seriesId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ API request failed:');
        console.error('Status:', response.status);
        console.error('Error data:', errorData);
        console.error('Error details:', JSON.stringify(errorData, null, 2));
        throw new Error(errorData.error || 'Failed to save emoticons');
      }

      const result = await response.json();
      console.log('✅ API response:', result);

      console.log('\n🎉 All scenes saved successfully!');
      alert(`${modifiedImages.length}개 이모티콘이 저장되었습니다!`);

      console.log('🔄 Refreshing router...');
      router.refresh();
      console.log('✅ Router refreshed');
    } catch (error) {
      console.error('❌ Save failed with error:', error);
      alert('이미지 저장에 실패했습니다.');
      throw error; // Re-throw to let ImageEditor know it failed
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <Loader2 className="animate-spin text-emerald-600" size={40} />
      </div>
    );
  }

  // 로그인하지 않은 경우
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="text-center">
          <Lock className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-4">로그인이 필요합니다.</p>
          <button
            onClick={() => router.push('/login')}
            className="px-4 py-2 bg-gradient-to-r from-emerald-400 to-emerald-500 text-white rounded-lg hover:from-emerald-500 hover:to-emerald-600 transition-all"
          >
            로그인
          </button>
        </div>
      </div>
    );
  }

  // 소유자가 아닌 경우
  if (isOwner === false) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="text-center">
          <Lock className="mx-auto text-gray-400 mb-4" size={48} />
          <p className="text-gray-600 mb-4">이 시리즈에 대한 편집 권한이 없습니다.</p>
          <button
            onClick={() => router.push('/my-series')}
            className="px-4 py-2 bg-gradient-to-r from-emerald-400 to-emerald-500 text-white rounded-lg hover:from-emerald-500 hover:to-emerald-600 transition-all"
          >
            내 시리즈로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 70px)' }}>
      <ImageEditor
        initialWidth={dimensions.width}
        initialHeight={dimensions.height}
        scenes={scenes}
        seriesId={seriesId || undefined}
        onSave={handleSave}
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <Loader2 className="animate-spin text-emerald-600" size={40} />
      </div>
    }>
      <EditorContent />
    </Suspense>
  );
}
