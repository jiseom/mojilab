'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2, Plus, AlertCircle, Clock, CheckCircle, XCircle, Crown, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EMOTICONS_STORAGE_URL } from '@/lib/constants';
import { supabase } from '@/lib/supabase';

interface LoRAModel {
  id: string;
  name: string;
  trigger_word: string;
  status: 'pending' | 'training' | 'completed' | 'failed';
  replicate_model_id?: string;
  training_images_count: number;
  created_at: string;
  error_message?: string;
}

export default function ProEmoticonPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [models, setModels] = useState<LoRAModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<LoRAModel | null>(null);
  const [character, setCharacter] = useState('');
  const [theme, setTheme] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monochromeOnly, setMonochromeOnly] = useState(true); // 흑백 전용 옵션
  const [emoticons, setEmoticons] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 32 });
  const [savedSeriesId, setSavedSeriesId] = useState<string | null>(null);
  const [isGeneratingTheme, setIsGeneratingTheme] = useState(false); // 테마 프롬프트 생성 중
  const [generatingThemeLabel, setGeneratingThemeLabel] = useState<string | null>(null); // 어떤 테마 버튼이 로딩중인지

  // 테마 프롬프트 LLM 생성
  const handleGenerateThemePrompt = async (themeLabel: string) => {
    setIsGeneratingTheme(true);
    setGeneratingThemeLabel(themeLabel);

    try {
      const response = await fetch('/api/emoticons/generate-theme-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeLabel, character }),
      });
      const data = await response.json();

      if (data.success && data.prompt) {
        setTheme(data.prompt);
      } else {
        console.error('Failed to generate theme prompt:', data.error);
        // 실패 시 기본 프롬프트 사용하지 않음 - 에러만 로깅
      }
    } catch (err) {
      console.error('Error generating theme prompt:', err);
    } finally {
      setIsGeneratingTheme(false);
      setGeneratingThemeLabel(null);
    }
  };

  // 모델 목록 로드
  useEffect(() => {
    if (user) {
      loadModels();
    }
  }, [user]);

  const loadModels = async () => {
    if (!user) return;

    try {
      // 세션에서 access_token 가져오기
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`/api/lora/models?userId=${user.id}`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      });
      const data = await response.json();

      if (data.success) {
        setModels(data.models);
        // 완료된 모델 중 첫 번째 자동 선택
        const completedModel = data.models.find((m: LoRAModel) => m.status === 'completed');
        if (completedModel) {
          setSelectedModel(completedModel);
        }
      }
    } catch (err) {
      console.error('모델 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedModel || !character.trim() || !theme.trim()) {
      setError('스타일, 캐릭터 설명, 테마를 모두 입력해주세요');
      return;
    }

    if (selectedModel.status !== 'completed') {
      setError('학습이 완료된 스타일만 사용할 수 있습니다');
      return;
    }

    setGenerating(true);
    setError(null);
    setEmoticons([]);
    setProgress({ current: 0, total: 32 });

    try {
      // 테마 기반 장면 생성
      const scenesResponse = await fetch('/api/emoticons/generate-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          character,
          theme,
          id:selectedModel?.id,
        }),
      });
      const scenesData = await scenesResponse.json();

      if (!scenesData.success) {
        throw new Error(scenesData.error || '장면 생성 실패');
      }

      const prompts = scenesData.scenes.map((scene: string) => `${character}, ${scene}`);
      const emotionNames = scenesData.scenes;

      // 2. 이미지 생성 API 호출 (saveToDb: true로 서버에서 직접 저장)
      const response = await fetch('/api/test-flux-lora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedModel.id,
          mode: 'text2img',
          style: 'pen', // 펜 스타일 (선명한 라인)
          prompts,
          monochromeOnly, // 흑백 전용 옵션 전달
          // 자동 저장 옵션 (서버에서 직접 DB 저장)
          saveToDb: true,
          userId: user?.id,
          character,
          theme: theme || 'Pro 이모티콘',
          emotionNames, // 실제 생성된 장면 이름 전달
        }),
      });

      const data = await response.json();

      if (data.success) {
        setEmoticons(data.results);

        // 서버에서 저장이 완료되면 seriesId가 반환됨
        if (data.savedSeriesId) {
          setSavedSeriesId(data.savedSeriesId);
        }

        // 자동 다운로드
        data.results.forEach((result: any, index: number) => {
          if (result.success && result.transparentDataUrl) {
            setTimeout(() => {
              const link = document.createElement('a');
              link.href = result.transparentDataUrl;
              link.download = `${character.split(',')[0]}-${index + 1}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }, index * 300);
          }
        });
      } else {
        throw new Error(data.error || '이미지 생성 실패');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="badge completed"><CheckCircle size={12} /> 완료</span>;
      case 'training':
        return <span className="badge training"><Clock size={12} /> 학습중</span>;
      case 'pending':
        return <span className="badge pending"><Clock size={12} /> 대기중</span>;
      case 'failed':
        return <span className="badge failed"><XCircle size={12} /> 실패</span>;
      default:
        return null;
    }
  };

  if (authLoading) {
    return (
      <div className="page">
        <div className="loading-container">
          <Loader2 size={48} className="spinner" />
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="auth-message">
          <AlertCircle size={48} />
          <h2>로그인이 필요합니다</h2>
          <p>Pro 이모티콘을 사용하려면 먼저 로그인해주세요</p>
          <button onClick={() => router.push('/login')} className="btn-primary">
            로그인하기
          </button>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-container">
          <Loader2 size={48} className="spinner" />
          <p>내 스타일 불러오는 중...</p>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  const completedModels = models.filter(m => m.status === 'completed');
  const trainingModels = models.filter(m => m.status === 'training' || m.status === 'pending');

  // 샘플 이모티콘들
  const sampleEmoticons = [
    `${EMOTICONS_STORAGE_URL}/gifs/27a77a40-b53d-4e0a-a8b5-b2cd02a84b69-1763709749993.gif`,
    `${EMOTICONS_STORAGE_URL}/gifs/df529d9f-544a-4935-8331-639cefc56ff3-1763525516379.gif`,
    `${EMOTICONS_STORAGE_URL}/9d12b481-89eb-4f5a-bfcd-8330d498ed7d/scene_15.png`,
    `${EMOTICONS_STORAGE_URL}/0c4e25da-493a-4a3f-af63-138cc2d51532/scene_0.png`,
    `${EMOTICONS_STORAGE_URL}/17336e41-2033-4efb-a473-2167d5d7735c/scene_12.png`,
    `${EMOTICONS_STORAGE_URL}/902a5aef-18bc-4521-be40-43510dc9e4a1/scene_6.png`,
    `${EMOTICONS_STORAGE_URL}/9d12b481-89eb-4f5a-bfcd-8330d498ed7d/scene_23.png`,
    `${EMOTICONS_STORAGE_URL}/902a5aef-18bc-4521-be40-43510dc9e4a1/scene_3.png`,
    `${EMOTICONS_STORAGE_URL}/28f599d1-7b7b-4f6f-8ce9-a2ff20595e60/scene_15.png`,
    `${EMOTICONS_STORAGE_URL}/2f0af6f8-cad9-48b2-808b-3578e348f37c/scene_1.png`
  ];

  return (
    <div className="page">
      {/* Hero Section with Emoticon Banner */}
        <div className="hero-section">
          <div className="hero-text">
            <div className="pro-badge">
              <Crown size={14} />
              PRO
            </div>
            <h1 className="hero-title">나만의 스타일로<br/>이모티콘 만들기</h1>
            <p className="hero-subtitle">AI가 당신의 그림체를 학습하여<br/>일관된 스타일의 이모티콘 32개를 생성합니다</p>
          </div>

          {/* Emoticon Banner */}
          <div className="emoticon-banner">
            <div className="emoticon-scroll">
              {sampleEmoticons.map((url, i) => (
                <div key={i} className="emoticon-item">
                  <img src={url} alt="" />
                </div>
              ))}
              {sampleEmoticons.map((url, i) => (
                <div key={`dup-${i}`} className="emoticon-item">
                  <img src={url} alt="" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="main-content">
          {/* 스타일 선택 */}
          <div className="section">
            <div className="section-header">
              <h2>
                <Sparkles size={20} className="section-icon" />
                내 스타일 선택
              </h2>
              <button onClick={() => router.push('/create/pro/train')} className="btn-add">
                <Plus size={16} />
                새 스타일 학습
              </button>
            </div>

            {models.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon-wrap">
                  <div className="empty-icon-glow" />
                  <Sparkles size={36} />
                </div>
                <h3>아직 학습된 스타일이 없어요</h3>
                <p>나만의 그림체로 이모티콘을 만들어보세요!<br/>5~10장의 이미지로 AI가 스타일을 학습합니다</p>
                <button onClick={() => router.push('/create/pro/train')} className="btn-primary-large">
                  <Crown size={18} />
                  첫 스타일 학습하기
                </button>
              </div>
            ) : (
              <>
                {/* 사용 가능한 스타일 */}
                {completedModels.length > 0 && (
                  <div className="models-section">
                    <h3>사용 가능한 스타일</h3>
                    <div className="models-grid">
                      {completedModels.map((model) => (
                        <div
                          key={model.id}
                          onClick={() => setSelectedModel(model)}
                          className={`model-card ${selectedModel?.id === model.id ? 'selected' : ''}`}
                        >
                          <div className="model-icon">
                            <Sparkles size={24} />
                          </div>
                          <div className="model-info">
                            <span className="model-name">{model.name}</span>
                            <span className="model-meta">{model.training_images_count}장 학습</span>
                          </div>
                          {selectedModel?.id === model.id ? (
                            <div className="check-icon">
                              <Check size={16} />
                            </div>
                          ) : (
                            getStatusBadge(model.status)
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 학습 중인 스타일 */}
                {trainingModels.length > 0 && (
                  <div className="models-section">
                    <h3>학습 중인 스타일</h3>
                    <div className="models-grid">
                      {trainingModels.map((model) => (
                        <div key={model.id} className="model-card disabled">
                          <div className="model-icon training">
                            <Loader2 size={24} className="spinner-small" />
                          </div>
                          <div className="model-info">
                            <span className="model-name">{model.name}</span>
                            <span className="model-meta">약 10-20분 소요</span>
                          </div>
                          {getStatusBadge(model.status)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </>
            )}
          </div>

          {/* 캐릭터 & 테마 입력 (스타일 선택 후) */}
          {selectedModel && (
            <div className="generate-section">
              {/* 작성 가이드 */}
              <div className="guide-box">
                <div className="guide-title">작성 팁</div>
                <ul className="guide-list">
                  <li><strong>캐릭터:</strong> 외형 특징을 구체적으로 (얼굴형, 눈, 색상 등)</li>
                  <li><strong>테마:</strong> 상황/감정을 다양하게 나열하면 풍부한 이모티콘 완성</li>
                </ul>
              </div>

              {/* 캐릭터 입력 */}
              <div className="input-section">
                <label className="label">캐릭터 설명</label>
                <textarea
                  value={character}
                  onChange={(e) => setCharacter(e.target.value)}
                  placeholder="예: 귀여운 고양이, 둥근 얼굴, 큰 눈, 주황색 털"
                  className="textarea"
                  maxLength={200}
                />
                <div className="input-footer">
                  <span className="char-count">{character.length}/200</span>
                </div>

                {/* 캐릭터 빠른 선택 */}
                <div className="quick-select">
                  <span className="quick-label">빠른 선택:</span>
                  <div className="quick-buttons">
                    {[
                      { emoji: '🐱', text: '귀여운 고양이, 둥근 얼굴, 큰 눈' },
                      { emoji: '🐻', text: '푸근한 곰, 갈색 털, 포근한 느낌' },
                      { emoji: '🐰', text: '발랄한 토끼, 긴 귀, 장난기 가득' },
                      { emoji: '🐶', text: '충직한 강아지, 처진 귀, 따뜻한 눈빛' },
                    ].map((sample) => (
                      <button
                        key={sample.emoji}
                        onClick={() => setCharacter(sample.text)}
                        className="quick-btn"
                      >
                        <span>{sample.emoji}</span>
                        <span>{sample.text.split(',')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 테마 입력 */}
              <div className="input-section">
                <label className="label">테마</label>
                <textarea
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="예: 직장생활, 학생 일과, 연애 감정... 상세하게 작성할수록 더 정확한 이모티콘이 생성됩니다."
                  className="textarea"
                  maxLength={500}
                />
                <div className="input-footer">
                  <span className="char-count">{theme.length}/500</span>
                </div>

                {/* 테마 빠른 선택 */}
                <div className="quick-select">
                  <span className="quick-label">AI 테마 생성:</span>
                  <div className="quick-buttons">
                    {[
                      { emoji: '💼', label: '직장생활' },
                      { emoji: '📚', label: '학생 일상' },
                      { emoji: '💑', label: '연애' },
                      { emoji: '🏠', label: '집순이/집돌이' },
                      { emoji: '🎮', label: '게이머' },
                      { emoji: '😊', label: '기본 감정' },
                      { emoji: '🍔', label: '음식/먹방' },
                      { emoji: '🎄', label: '계절/명절' },
                      { emoji: '🐾', label: '반려동물' },
                      { emoji: '💪', label: '운동/다이어트' },
                      { emoji: '✈️', label: '여행' },
                      { emoji: '☕', label: '카페/힐링' },
                    ].map((preset) => (
                      <button
                        key={preset.emoji}
                        onClick={() => handleGenerateThemePrompt(preset.label)}
                        disabled={isGeneratingTheme}
                        className={`quick-btn ${generatingThemeLabel === preset.label ? 'loading' : ''}`}
                      >
                        {generatingThemeLabel === preset.label ? (
                          <Loader2 size={14} className="spinner-small" />
                        ) : (
                          <span>{preset.emoji}</span>
                        )}
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 흑백 전용 옵션 */}
              <div className="option-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={monochromeOnly}
                    onChange={(e) => setMonochromeOnly(e.target.checked)}
                  />
                  <span className="checkbox-text">흑백 전용 (컬러 없이 생성)</span>
                </label>
              </div>

              {error && (
                <div className="error-box">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {/* 생성 버튼 또는 진행 상황 */}
              {!generating && emoticons.length === 0 && (
                <button
                  onClick={handleGenerate}
                  disabled={!character.trim() || !theme.trim()}
                  className="btn-generate"
                >
                  <Sparkles size={20} />
                  32개 이모티콘 생성
                </button>
              )}

              {/* 생성 중 */}
              {generating && (
                <div className="progress-section">
                  <Loader2 size={32} className="spinner" />
                  <p className="progress-text">이모티콘 생성 중...</p>
                  <p className="progress-hint">약 30분 소요됩니다. 잠시만 기다려주세요</p>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                  </div>
                  <p className="progress-count">{progress.current}/{progress.total} 완료</p>
                </div>
              )}

              {/* 생성 완료 */}
              {!generating && emoticons.length > 0 && (
                <div className="results-section">
                  <div className="results-header">
                    <CheckCircle size={20} className="success-icon" />
                    <span>
                      {savedSeriesId
                        ? '생성 및 저장 완료!'
                        : '생성 완료! PNG 파일이 자동으로 다운로드되었습니다'}
                    </span>
                  </div>
                  {savedSeriesId && (
                    <div className="saved-link">
                      <a href="/my-series" className="btn-view-series">
                        내 이모티콘에서 보기 →
                      </a>
                    </div>
                  )}
                  <div className="emoticons-grid">
                    {emoticons.map((emoticon, index) => (
                      <div key={index} className="emoticon-result">
                        {emoticon.success && emoticon.transparentDataUrl ? (
                          <img src={emoticon.transparentDataUrl} alt={`이모티콘 ${index + 1}`} />
                        ) : (
                          <div className="emoticon-error">실패</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setEmoticons([]); setCharacter(''); setTheme(''); }} className="btn-reset">
                    새로 만들기
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <style jsx>{styles}</style>
      </div>
  );
}

const styles = `
  .page {
    min-height: 100vh;
    background: #f5f5f7;
  }

  /* Hero Section */
  .hero-section {
    padding: 48px 32px;
    text-align: center;
    background: #f5f5f7;
  }

  .hero-text {
    max-width: 600px;
    margin: 0 auto 40px auto;
  }

  .pro-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: #1a1a1a;
    color: white;
    font-size: 11px;
    font-weight: 700;
    border-radius: 6px;
    letter-spacing: 0.5px;
    margin-bottom: 16px;
  }

  .hero-title {
    font-size: 36px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0 0 12px 0;
    line-height: 1.3;
    letter-spacing: -0.02em;
  }

  .hero-subtitle {
    font-size: 15px;
    color: #888;
    margin: 0;
    line-height: 1.6;
  }

  /* Emoticon Banner */
  .emoticon-banner {
    overflow: hidden;
    padding: 16px 0;
    mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
  }

  .emoticon-scroll {
    display: flex;
    gap: 24px;
    animation: scroll 25s linear infinite;
    width: max-content;
  }

  @keyframes scroll {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  .emoticon-item {
    width: 120px;
    height: 120px;
    background: #ffffff;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: transform 0.3s;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }

  .emoticon-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .emoticon-item:hover {
    transform: scale(1.08);
  }

  /* Main Content */
  .main-content {
    max-width: 1000px;
    margin: 0 auto;
    padding: 48px 40px;
  }

  /* Section */
  .section {
    margin-bottom: 48px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .section-header h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 600;
    color: #1a1a1a;
    margin: 0;
  }

  .section-icon {
    color: #888;
  }

  .btn-add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 20px;
    background: #1a1a1a;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-add:hover {
    background: #333;
    transform: translateY(-1px);
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 80px 40px;
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 20px;
    text-align: center;
  }

  .empty-icon-wrap {
    position: relative;
    width: 80px;
    height: 80px;
    background: #f0f0f0;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    margin-bottom: 24px;
  }

  .empty-icon-glow {
    display: none;
  }

  .empty-state h3 {
    font-size: 20px;
    font-weight: 600;
    color: #1a1a1a;
    margin: 0 0 8px 0;
  }

  .empty-state p {
    color: #888;
    font-size: 15px;
    line-height: 1.7;
    margin: 0 0 28px 0;
    max-width: 360px;
  }

  .btn-primary-large {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 16px 32px;
    background: #1a1a1a;
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary-large:hover {
    background: #333;
    transform: translateY(-2px);
  }

  /* Models Section */
  .models-section {
    margin-bottom: 32px;
  }

  .models-section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #999;
    margin: 0 0 16px 0;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }

  .models-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }

  .model-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 20px;
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .model-card:hover:not(.disabled) {
    background: #f5f5f5;
    border-color: #ddd;
  }

  .model-card.selected {
    background: #ecfdf5;
    border-color: #10b981;
  }

  .model-card.selected:hover {
    background: #d1fae5;
    border-color: #10b981;
  }

  .model-card.selected .model-icon {
    background: #d1fae5;
    color: #059669;
  }

  .check-icon {
    width: 28px;
    height: 28px;
    background: #10b981;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
  }

  .model-card.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .model-icon {
    width: 48px;
    height: 48px;
    background: #eee;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    flex-shrink: 0;
  }

  .model-icon.training {
    background: #fef3c7;
    color: #d97706;
  }


  .model-info {
    flex: 1;
    min-width: 0;
  }

  .model-name {
    display: block;
    font-size: 15px;
    font-weight: 600;
    color: #1a1a1a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .model-meta {
    display: block;
    font-size: 13px;
    color: #999;
    margin-top: 2px;
  }

  .badge {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .badge.completed {
    background: #f0f0f0;
    color: #22c55e;
  }

  .badge.training {
    background: #fef3c7;
    color: #d97706;
  }

  .badge.pending {
    background: #f0f0f0;
    color: #6366f1;
  }

  .badge.failed {
    background: #fee2e2;
    color: #dc2626;
  }

  /* Generate Section */
  .generate-section {
    background: #fafafa;
    border: 1px solid #eee;
    border-radius: 20px;
    padding: 32px;
  }

  .guide-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 24px;
  }

  .guide-title {
    font-size: 13px;
    font-weight: 600;
    color: #64748b;
    margin-bottom: 10px;
  }

  .guide-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .guide-list li {
    font-size: 13px;
    color: #475569;
    line-height: 1.5;
  }

  .guide-list li strong {
    color: #1e293b;
  }

  .input-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 24px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
  }

  .label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    color: #666;
    margin-bottom: 10px;
  }

  .input {
    width: 100%;
    padding: 16px 18px;
    font-size: 15px;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    transition: all 0.2s;
    background: white;
  }

  .input:focus {
    outline: none;
    border-color: #1a1a1a;
  }

  .hint {
    font-size: 12px;
    color: #999;
  }

  /* Input Section */
  .input-section {
    margin-bottom: 24px;
  }

  .textarea {
    width: 100%;
    padding: 16px 18px;
    font-size: 15px;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    transition: all 0.2s;
    background: white;
    resize: none;
    min-height: 100px;
  }

  .textarea:focus {
    outline: none;
    border-color: #1a1a1a;
  }

  .input-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }

  .char-count {
    font-size: 12px;
    color: #999;
  }

  /* Quick Select */
  .quick-select {
    margin-top: 16px;
  }

  .quick-label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #666;
    margin-bottom: 10px;
  }

  .quick-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .quick-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    color: #666;
    cursor: pointer;
    transition: all 0.2s;
  }

  .quick-btn:hover {
    border-color: #1a1a1a;
    color: #1a1a1a;
    background: #f9f9f9;
  }

  .quick-btn.active {
    background: #1a1a1a;
    border-color: #1a1a1a;
    color: white;
  }

  .quick-btn.loading {
    background: #f0f0f0;
    border-color: #ccc;
    color: #888;
    cursor: wait;
  }

  .quick-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .quick-btn:disabled:hover {
    border-color: #e5e5e5;
    color: #666;
    background: white;
  }

  .quick-btn.loading:hover {
    border-color: #ccc;
    background: #f0f0f0;
  }

  .error-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 12px;
    margin-bottom: 20px;
    color: #dc2626;
    font-size: 14px;
    font-weight: 500;
  }

  .btn-primary {
    padding: 14px 24px;
    background: #1a1a1a;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-generate {
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    display: flex;
    padding: 18px 36px;
    background: #1a1a1a;
    color: white;
    border: none;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: all 0.2s;
  }

  .btn-generate:hover:not(:disabled) {
    background: #333;
    transform: translateY(-2px);
  }

  .btn-generate:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Option Row (체크박스) */
  .option-row {
    margin-bottom: 24px;
    padding: 16px;
    background: #f0f9f4;
    border: 1px solid #d1fae5;
    border-radius: 12px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    width: 20px;
    height: 20px;
    accent-color: #10b981;
  }

  .checkbox-text {
    font-size: 15px;
    font-weight: 600;
    color: #1a1a1a;
  }

  .option-hint {
    font-size: 12px;
    color: #6b7280;
    margin: 8px 0 0 30px;
  }

  /* Progress Section */
  .progress-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 40px 20px;
  }

  .progress-text {
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
    margin: 16px 0 4px 0;
  }

  .progress-hint {
    font-size: 14px;
    color: #888;
    margin: 0 0 20px 0;
  }

  .progress-bar {
    width: 100%;
    max-width: 400px;
    height: 8px;
    background: #e5e5e5;
    border-radius: 4px;
    margin: 0 auto 8px auto;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #10b981;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .progress-count {
    font-size: 13px;
    color: #666;
    margin: 0;
  }

  /* Results Section */
  .results-section {
    margin-top: 24px;
  }

  .results-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 12px;
    margin-bottom: 24px;
    color: #16a34a;
    font-weight: 600;
  }

  .success-icon {
    color: #16a34a;
  }

  .emoticons-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px;
    margin-bottom: 24px;
  }

  @media (max-width: 900px) {
    .emoticons-grid {
      grid-template-columns: repeat(5, 1fr);
    }
  }

  @media (max-width: 640px) {
    .emoticons-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .emoticon-result {
    aspect-ratio: 1;
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    overflow: hidden;
  }

  .emoticon-result img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .emoticon-error {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #dc2626;
    font-size: 12px;
    background: #fef2f2;
  }

  .btn-reset {
    display: block;
    margin: 0 auto;
    padding: 14px 32px;
    background: #f5f5f5;
    color: #1a1a1a;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-reset:hover {
    background: #eee;
  }

  .saved-link {
    text-align: center;
    margin-bottom: 20px;
  }

  .btn-view-series {
    display: inline-block;
    padding: 12px 24px;
    background: #10b981;
    color: white;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s;
  }

  .btn-view-series:hover {
    background: #059669;
    transform: translateY(-1px);
  }

  /* Loading & Auth */
  .loading-container, .auth-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
  }

  .spinner {
    animation: spin 1s linear infinite;
    color: #1a1a1a;
  }

  .spinner-small {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .loading-container p {
    margin-top: 20px;
    color: #888;
    font-size: 15px;
  }

  .auth-message {
    padding: 60px 40px;
  }

  .auth-message h2 {
    font-size: 22px;
    font-weight: 600;
    margin: 16px 0 8px 0;
    color: #1a1a1a;
  }

  .auth-message p {
    color: #888;
    margin: 0 0 24px 0;
    font-size: 15px;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .hero-section {
      padding: 48px 24px;
    }

    .hero-title {
      font-size: 32px;
    }

    .main-content {
      padding: 32px 24px;
    }

    .input-row {
      grid-template-columns: 1fr;
      gap: 16px;
    }

    .models-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 640px) {
    .page-header {
      padding: 16px 20px;
    }

    .hero-section {
      padding: 40px 20px;
    }

    .hero-title {
      font-size: 28px;
    }

    .hero-subtitle {
      font-size: 15px;
    }

    .emoticon-item {
      width: 60px;
      height: 60px;
      font-size: 28px;
      border-radius: 14px;
    }

    .main-content {
      padding: 24px 16px;
    }

    .section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 16px;
    }

    .empty-state {
      padding: 48px 24px;
    }

    .generate-section {
      padding: 24px 20px;
    }
  }
`;
