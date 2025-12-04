'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Sparkles, Eye, Download, ChevronLeft, ChevronRight, Image as ImageIcon, FolderOpen, Lock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface Scene {
  id: string;
  description: string;
  dialogue: string;
  characterExpression: string;
  emoticonUrl?: string;
}

interface EmoticonSeries {
  id: string;
  title: string;
  thumbnail_url: string | null;
  scenes: EmoticonScene[];
}

interface EmoticonScene {
  id: string;
  image_url: string;
  title: string;
}

export default function InstatoonEditorPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [characters, setCharacters] = useState<File[]>([]);
  const [characterPreviews, setCharacterPreviews] = useState<string[]>([]);
  const [story, setStory] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadTab, setUploadTab] = useState<'upload' | 'library'>('library');
  const [mySeries, setMySeries] = useState<EmoticonSeries[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [selectedEmoticons, setSelectedEmoticons] = useState<string[]>([]);
  const [seriesPage, setSeriesPage] = useState(0);

  const steps = [
    { number: 1, title: '캐릭터 선택', icon: Upload },
    { number: 2, title: '줄거리 입력', icon: Sparkles },
    { number: 3, title: '컷 구성', icon: Eye },
    { number: 4, title: '미리보기', icon: Download },
  ];

  useEffect(() => {
    if (user) {
      fetchMySeries();
    }
  }, [user]);

  const fetchMySeries = async () => {
    try {
      if (!user) return;

      const { data: seriesData, error } = await supabase
        .from('emoticon_series')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Fetch scenes for each series (모든 이모티콘)
      const seriesWithScenes = await Promise.all(
        (seriesData || []).map(async (series) => {
          const { data: scenesData } = await supabase
            .from('emoticon_scenes')
            .select('id, image_url, title')
            .eq('series_id', series.id)
            .order('scene_number');

          return {
            id: series.id,
            title: series.title,
            thumbnail_url: scenesData?.[0]?.image_url || null,
            scenes: scenesData || [],
          };
        })
      );

      setMySeries(seriesWithScenes);
    } catch (error) {
      console.error('Error fetching series:', error);
    }
  };

  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setCharacters(files);

    // Create preview URLs
    const previews = files.map(file => URL.createObjectURL(file));
    setCharacterPreviews(previews);
  };

  const toggleEmoticonSelection = (imageUrl: string) => {
    if (selectedEmoticons.includes(imageUrl)) {
      setSelectedEmoticons(selectedEmoticons.filter(url => url !== imageUrl));
    } else if (selectedEmoticons.length < 6) {
      setSelectedEmoticons([...selectedEmoticons, imageUrl]);
    }
  };

  const handleGenerateScenes = async () => {
    if (!story.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch('/api/instatoon/generate-scenes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          story: story.trim(),
          sceneCount: 4,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '씬 생성에 실패했습니다.');
      }

      if (data.success && data.scenes) {
        setScenes(data.scenes);
        setCurrentStep(3);
      } else {
        throw new Error('씬 데이터가 없습니다.');
      }
    } catch (error: any) {
      console.error('씬 생성 오류:', error);
      alert(error.message || '씬 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return uploadTab === 'upload' ? characters.length > 0 : selectedEmoticons.length > 0;
      case 2:
        return story.trim().length > 10;
      case 3:
        return scenes.length > 0;
      default:
        return true;
    }
  };

  const selectedSeries = mySeries.find(s => s.id === selectedSeriesId);

  const SERIES_PER_PAGE = 6;
  const totalPages = Math.ceil(mySeries.length / SERIES_PER_PAGE);
  const paginatedSeries = mySeries.slice(
    seriesPage * SERIES_PER_PAGE,
    (seriesPage + 1) * SERIES_PER_PAGE
  );

  // 로딩 중
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <Loader2 className="animate-spin text-emerald-600" size={40} />
      </div>
    );
  }

  // 로그인 필요
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

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Progress Stepper */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                      currentStep >= step.number
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-white border-gray-300 text-gray-400'
                    }`}
                  >
                    <step.icon size={20} />
                  </div>
                  <span
                    className={`mt-2 text-sm font-medium ${
                      currentStep >= step.number ? 'text-emerald-600' : 'text-gray-400'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-4 transition-all ${
                      currentStep > step.number ? 'bg-emerald-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-8 py-12 pb-32">
        <AnimatePresence mode="wait">
          {/* Step 1: Character Selection */}
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto"
            >
              <h2 className="text-3xl font-bold text-gray-800 mb-2 text-center">
                캐릭터를 선택하세요
              </h2>
              <p className="text-gray-600 mb-8 text-center">
                내 이모티콘에서 선택하거나 새로 업로드하세요 (최대 6개)
              </p>

              {/* Tabs */}
              <div className="flex gap-4 mb-6 justify-center">
                <button
                  onClick={() => setUploadTab('library')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                    uploadTab === 'library'
                      ? 'bg-emerald-500 text-white shadow-md'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <FolderOpen size={20} />
                  내 이모티콘
                </button>
                <button
                  onClick={() => setUploadTab('upload')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
                    uploadTab === 'upload'
                      ? 'bg-emerald-500 text-white shadow-md'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Upload size={20} />
                  파일 업로드
                </button>
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-8">
                {/* Library Tab */}
                {uploadTab === 'library' && (
                  <div>
                    {mySeries.length === 0 ? (
                      <div className="text-center py-12">
                        <Sparkles className="mx-auto text-gray-300 mb-4" size={64} />
                        <p className="text-gray-600 mb-4">아직 생성한 이모티콘이 없어요</p>
                        <button
                          onClick={() => setUploadTab('upload')}
                          className="text-emerald-600 font-medium hover:underline"
                        >
                          파일 업로드로 이동하기 →
                        </button>
                      </div>
                    ) : (
                      <div>
                        {/* Emoticon Selection - 위로 이동 */}
                        {selectedSeries && (
                          <div className="mb-8 p-6 bg-emerald-50 rounded-xl border-2 border-emerald-200">
                            <div className="flex justify-between items-center mb-4">
                              <label className="block text-base font-semibold text-gray-800">
                                선택된 시리즈: {selectedSeries.title}
                              </label>
                              {selectedEmoticons.length > 0 && (
                                <button
                                  onClick={() => setSelectedEmoticons([])}
                                  className="text-sm text-red-600 hover:underline font-medium"
                                >
                                  선택 해제
                                </button>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mb-3">
                              이모티콘 선택: {selectedEmoticons.length}/6
                            </p>
                            <div className="grid grid-cols-6 gap-3">
                              {selectedSeries.scenes.map((scene) => (
                                <div
                                  key={scene.id}
                                  onClick={() => toggleEmoticonSelection(scene.image_url)}
                                  className={`relative aspect-square rounded-lg border-2 cursor-pointer transition-all overflow-hidden ${
                                    selectedEmoticons.includes(scene.image_url)
                                      ? 'border-emerald-500 ring-2 ring-emerald-300'
                                      : 'border-gray-300 hover:border-emerald-400'
                                  }`}
                                >
                                  <img
                                    src={scene.image_url}
                                    alt={scene.title}
                                    className="w-full h-full object-cover"
                                  />
                                  {selectedEmoticons.includes(scene.image_url) && (
                                    <div className="absolute inset-0 bg-emerald-500 bg-opacity-20 flex items-center justify-center">
                                      <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                                        <svg
                                          width="16"
                                          height="16"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="white"
                                          strokeWidth="3"
                                        >
                                          <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Series Selection - 아래로 이동 */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-3">
                            시리즈 선택
                          </label>
                          <div className="relative">
                            <div className="grid grid-cols-3 gap-4">
                              {paginatedSeries.map((series) => (
                                <div
                                  key={series.id}
                                  onClick={() => {
                                    setSelectedSeriesId(series.id);
                                    setSelectedEmoticons([]);
                                  }}
                                  className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                                    selectedSeriesId === series.id
                                      ? 'border-emerald-500 bg-emerald-50'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                >
                                  <div className="aspect-square bg-gray-100 rounded-lg mb-2 overflow-hidden">
                                    {series.thumbnail_url ? (
                                      <img
                                        src={series.thumbnail_url}
                                        alt={series.title}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Sparkles className="text-gray-300" size={32} />
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium text-gray-800 text-center truncate">
                                    {series.title}
                                  </p>
                                </div>
                              ))}
                            </div>

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                              <div className="flex items-center justify-center gap-4 mt-4">
                                <button
                                  onClick={() => setSeriesPage(Math.max(0, seriesPage - 1))}
                                  disabled={seriesPage === 0}
                                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                  <ChevronLeft size={20} />
                                </button>
                                <span className="text-sm text-gray-600">
                                  {seriesPage + 1} / {totalPages}
                                </span>
                                <button
                                  onClick={() => setSeriesPage(Math.min(totalPages - 1, seriesPage + 1))}
                                  disabled={seriesPage === totalPages - 1}
                                  className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                >
                                  <ChevronRight size={20} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Upload Tab */}
                {uploadTab === 'upload' && (
                  <div>
                    <label
                      htmlFor="character-upload"
                      className="block border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 transition-all"
                    >
                      <Upload className="mx-auto text-gray-400 mb-4" size={48} />
                      <p className="text-lg font-medium text-gray-700 mb-2">
                        클릭하거나 파일을 드래그하세요
                      </p>
                      <p className="text-sm text-gray-500">PNG, JPG (최대 6개)</p>
                      <input
                        id="character-upload"
                        type="file"
                        accept="image/png,image/jpeg"
                        multiple
                        className="hidden"
                        onChange={handleCharacterUpload}
                      />
                    </label>

                    {/* Preview Grid */}
                    {characterPreviews.length > 0 && (
                      <div className="mt-6 grid grid-cols-3 gap-4">
                        {characterPreviews.map((preview, index) => (
                          <div
                            key={index}
                            className="aspect-square rounded-lg overflow-hidden border-2 border-emerald-500"
                          >
                            <img
                              src={preview}
                              alt={`Character ${index + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Guidelines */}
                    <div className="mt-6 bg-blue-50 rounded-lg p-4">
                      <p className="text-sm text-blue-800 font-medium mb-2">💡 팁</p>
                      <ul className="text-sm text-blue-700 space-y-1">
                        <li>✅ 배경이 투명한 PNG 파일을 권장합니다</li>
                        <li>✅ 정사각형 비율의 이미지가 가장 잘 어울려요</li>
                        <li>✅ 캐릭터의 다양한 표정이 있으면 더 풍부해집니다</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Step 2: Story Input */}
          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="grid grid-cols-5 gap-8">
                {/* Left Panel */}
                <div className="col-span-3">
                  <h2 className="text-3xl font-bold text-gray-800 mb-2">
                    어떤 이야기를 만들까요?
                  </h2>
                  <p className="text-gray-600 mb-6">
                    줄거리를 입력하면 AI가 자동으로 웹툰 컷을 구성해드려요
                  </p>

                  <div className="bg-white rounded-2xl shadow-lg p-8">
                    <textarea
                      value={story}
                      onChange={(e) => setStory(e.target.value)}
                      placeholder="예: 주인공이 아침에 늦잠을 자서 급하게 준비하고 집을 나섰는데, 문 앞에서 친구를 만나 함께 학교로 뛰어간다..."
                      className="w-full h-48 p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      maxLength={500}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-sm text-gray-500">
                        {story.length} / 500자
                      </span>
                      <button
                        onClick={handleGenerateScenes}
                        disabled={!story.trim() || isGenerating}
                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isGenerating ? (
                          <>
                            <Sparkles className="animate-spin" size={20} />
                            생성 중...
                          </>
                        ) : (
                          <>
                            <Sparkles size={20} />
                            컷 구성하기
                          </>
                        )}
                      </button>
                    </div>

                    {/* Quick Examples */}
                    <div className="mt-6">
                      <p className="text-sm font-medium text-gray-700 mb-3">
                        💡 빠른 예시 템플릿
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          '🏫 학교 일상',
                          '💼 직장 생활',
                          '🏠 집콕 라이프',
                          '☕ 카페 데이트',
                        ].map((template) => (
                          <button
                            key={template}
                            onClick={() => {
                              if (template === '🏫 학교 일상') {
                                setStory(
                                  '주인공이 아침에 늦잠을 자서 급하게 준비하고 집을 나섰는데, 문 앞에서 친구를 만나 함께 학교로 뛰어간다.'
                                );
                              }
                            }}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors"
                          >
                            {template}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel - Guide */}
                <div className="col-span-2">
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl shadow-lg p-6 sticky top-8">
                    <h3 className="text-xl font-bold text-gray-800 mb-4">
                      ✨ AI가 이렇게 도와드려요
                    </h3>
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold flex-shrink-0">
                          1
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">컷 분할</p>
                          <p className="text-sm text-gray-600">
                            스토리를 3-6개의 장면으로 나눠요
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold flex-shrink-0">
                          2
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">대사 생성</p>
                          <p className="text-sm text-gray-600">
                            각 장면에 어울리는 대사를 작성해요
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold flex-shrink-0">
                          3
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">레이아웃</p>
                          <p className="text-sm text-gray-600">
                            인스타그램에 최적화된 배치를 해요
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 p-4 bg-white rounded-lg">
                      <p className="text-sm text-gray-600">
                        <span className="font-semibold text-gray-800">
                          예상 소요 시간:
                        </span>{' '}
                        약 30-60초
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Scene Editor */}
          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <h2 className="text-3xl font-bold text-gray-800 mb-2 text-center">
                컷 구성을 확인하고 수정하세요
              </h2>
              <p className="text-gray-600 mb-8 text-center">
                각 장면에 맞는 이모티콘을 선택하고 대사를 편집하세요
              </p>

              <div className="grid grid-cols-2 gap-6">
                {scenes.map((scene, index) => (
                  <div
                    key={scene.id}
                    className="bg-white rounded-xl shadow-lg p-6 border-2 border-gray-200 hover:border-emerald-500 transition-all"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center font-bold text-lg flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        {/* 이모티콘 선택 */}
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            이모티콘 선택
                          </label>
                          <div className="flex gap-2 flex-wrap">
                            {selectedEmoticons.map((url, emoticonIndex) => (
                              <div
                                key={emoticonIndex}
                                onClick={() => {
                                  const newScenes = [...scenes];
                                  newScenes[index].emoticonUrl = url;
                                  setScenes(newScenes);
                                }}
                                className={`w-14 h-14 rounded-lg border-2 cursor-pointer overflow-hidden transition-all ${
                                  scene.emoticonUrl === url
                                    ? 'border-emerald-500 ring-2 ring-emerald-300'
                                    : 'border-gray-200 hover:border-gray-400'
                                }`}
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                          {scene.emoticonUrl && (
                            <p className="text-xs text-emerald-600 mt-1">✓ 선택됨</p>
                          )}
                        </div>

                        <div className="mb-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            장면 설명
                          </label>
                          <input
                            type="text"
                            value={scene.description}
                            onChange={(e) => {
                              const newScenes = [...scenes];
                              newScenes[index].description = e.target.value;
                              setScenes(newScenes);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div className="mb-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            대사
                          </label>
                          <input
                            type="text"
                            value={scene.dialogue}
                            onChange={(e) => {
                              const newScenes = [...scenes];
                              newScenes[index].dialogue = e.target.value;
                              setScenes(newScenes);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            표정/분위기
                          </label>
                          <select
                            value={scene.characterExpression}
                            onChange={(e) => {
                              const newScenes = [...scenes];
                              newScenes[index].characterExpression = e.target.value;
                              setScenes(newScenes);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="웃음">😊 웃음</option>
                            <option value="놀람">😲 놀람</option>
                            <option value="다급함">😰 다급함</option>
                            <option value="당황">😅 당황</option>
                            <option value="화남">😠 화남</option>
                            <option value="슬픔">😢 슬픔</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 4: Preview */}
          {currentStep === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-5xl mx-auto"
            >
              <h2 className="text-3xl font-bold text-gray-800 mb-2 text-center">
                인스타툰이 완성되었어요!
              </h2>
              <p className="text-gray-600 mb-8 text-center">
                미리보기를 확인하고 다운로드하세요
              </p>

              <div className="flex gap-8 justify-center items-start">
                {/* Instagram Preview */}
                <div className="bg-white rounded-2xl shadow-2xl p-6">
                  <div
                    className="w-[375px] bg-white rounded-lg border-2 border-gray-200 overflow-hidden"
                    style={{ aspectRatio: '4/5' }}
                  >
                    <div className="grid grid-cols-2 grid-rows-2 h-full">
                      {scenes.slice(0, 4).map((scene, index) => (
                        <div
                          key={scene.id}
                          className="relative border border-gray-200 flex flex-col bg-white"
                        >
                          {/* Scene Number */}
                          <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-gray-800 text-white text-xs flex items-center justify-center font-bold z-10">
                            {index + 1}
                          </div>

                          {/* Character Image */}
                          <div className="flex-1 flex items-center justify-center p-2">
                            {scene.emoticonUrl ? (
                              <img
                                src={scene.emoticonUrl}
                                alt={`Scene ${index + 1}`}
                                className="max-w-full max-h-full object-contain"
                                style={{ maxHeight: '100px' }}
                              />
                            ) : (
                              <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                                <ImageIcon size={24} className="text-gray-400" />
                              </div>
                            )}
                          </div>

                          {/* Dialogue Bubble */}
                          <div className="px-2 pb-2">
                            <div className="bg-gray-100 rounded-lg px-2 py-1">
                              <p className="text-xs font-medium text-gray-800 text-center leading-tight">
                                {scene.dialogue}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-center text-sm text-gray-500 mt-3">4:5 비율 (1080 × 1350)</p>
                </div>

                {/* Scene Details */}
                <div className="flex-1 max-w-md">
                  <h3 className="text-lg font-bold text-gray-800 mb-4">장면 구성</h3>
                  <div className="space-y-3">
                    {scenes.slice(0, 4).map((scene, index) => (
                      <div key={scene.id} className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                        <div className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-emerald-500 text-white text-sm flex items-center justify-center font-bold flex-shrink-0">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 mb-1">{scene.description}</p>
                            <p className="text-sm font-medium text-gray-800">"{scene.dialogue}"</p>
                            <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                              {scene.characterExpression}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Download Button */}
              <div className="mt-8 text-center">
                <button className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg font-semibold text-lg hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-lg">
                  <Download size={24} />
                  인스타툰 다운로드
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-4 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center" style={{ marginLeft: '60px' }}>
          <button
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={20} />
            이전
          </button>

          <div className="text-sm text-gray-600">
            {currentStep} / {steps.length}
          </div>

          <button
            onClick={() => setCurrentStep((prev) => Math.min(4, prev + 1))}
            disabled={!canProceed() || currentStep === 4}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg font-medium hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            다음
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
