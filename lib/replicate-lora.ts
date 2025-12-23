// Replicate API를 직접 fetch로 호출

// LoRA 학습 설정 (고정값)
export const LORA_TRAINING_CONFIG = {
  // 베이스 모델
  model: 'ostris/flux-dev-lora-trainer',
  base: 'flux-dev',

  // 학습 파라미터 (고정)
  steps: 1000,
  rank: 16,
  learning_rate: 0.0004,
  optimizer: 'adamw8bit',
  autocaption: true,

  // 이미지 요구사항
  minImages: 10,
  maxImages: 30,
  recommendedImages: 20,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedFormats: ['image/png', 'image/jpeg'],

  // 비용/시간 예상
  estimatedTime: '10-20분',
  estimatedCost: '$3-5',
} as const;

// 이미지 검증
export function validateTrainingImages(files: File[]): string[] {
  const errors: string[] = [];

  if (files.length < LORA_TRAINING_CONFIG.minImages) {
    errors.push(`최소 ${LORA_TRAINING_CONFIG.minImages}장의 이미지가 필요합니다`);
  }
  if (files.length > LORA_TRAINING_CONFIG.maxImages) {
    errors.push(`최대 ${LORA_TRAINING_CONFIG.maxImages}장까지 업로드 가능합니다`);
  }

  files.forEach((file, i) => {
    if (file.size > LORA_TRAINING_CONFIG.maxFileSize) {
      errors.push(`이미지 ${i + 1}: 10MB 이하여야 합니다`);
    }
    if (!LORA_TRAINING_CONFIG.allowedFormats.includes(file.type as 'image/png' | 'image/jpeg')) {
      errors.push(`이미지 ${i + 1}: PNG 또는 JPG만 가능합니다`);
    }
  });

  return errors;
}

// LoRA 학습 시작 (직접 fetch API 사용)
export async function trainLoRA(params: {
  trainingDataUrl: string; // ZIP 파일 URL
  triggerWord: string;
  // webhookUrl: string;
  modelName: string; // 모델 이름 (예: "style-abc12345")
  description?: string;
}) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  const owner = process.env.REPLICATE_USERNAME;

  if (!apiToken) {
    throw new Error('REPLICATE_API_TOKEN이 설정되지 않았습니다');
  }

  if (!owner) {
    throw new Error('REPLICATE_USERNAME이 설정되지 않았습니다. .env.local에 추가해주세요.');
  }

  // 1. 먼저 destination 모델을 private으로 생성
  const createModelRes = await fetch('https://api.replicate.com/v1/models', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      owner,
      name: params.modelName,
      visibility: 'private',
      hardware: 'gpu-t4',
      description: params.description || 'Custom LoRA style model',
    }),
  });

  if (!createModelRes.ok) {
    const errorData = await createModelRes.json();
    // 이미 존재하는 경우만 무시
    if (!errorData.detail?.includes('already exists')) {
      console.error('Model create error:', errorData);
      throw new Error(`모델 생성 실패: ${errorData.detail || JSON.stringify(errorData)}`);
    }
  }

  const destination = `${owner}/${params.modelName}`;

  // 2. flux-dev-lora-trainer의 최신 버전 ID
  const FLUX_DEV_LORA_TRAINER_VERSION = 'd995297071a44dcb72244e6c19462111649ec86a9646c32df56daa7f14801944';

  // 3. 학습 시작 (fetch API 사용)
  const trainingRes = await fetch(
    `https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer/versions/${FLUX_DEV_LORA_TRAINER_VERSION}/trainings`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        destination,
        input: {
          input_images: params.trainingDataUrl,
          trigger_word: params.triggerWord,
          steps: LORA_TRAINING_CONFIG.steps,
          lora_rank: LORA_TRAINING_CONFIG.rank,
          learning_rate: LORA_TRAINING_CONFIG.learning_rate,
          optimizer: LORA_TRAINING_CONFIG.optimizer,
          autocaption: LORA_TRAINING_CONFIG.autocaption,
        },
        // webhook: params.webhookUrl,
        // webhook_events_filter: ['start', 'completed'],
      }),
    }
  );

  if (!trainingRes.ok) {
    const errorData = await trainingRes.json();
    throw new Error(errorData.detail || '학습 시작에 실패했습니다');
  }

  const training = await trainingRes.json();

  return { training, destination };
}

// 학습 상태 조회
export async function getTrainingStatus(trainingId: string) {
  const apiToken = process.env.REPLICATE_API_TOKEN;

  const res = await fetch(`https://api.replicate.com/v1/trainings/${trainingId}`, {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!res.ok) {
    throw new Error('학습 상태 조회 실패');
  }

  const training = await res.json();

  return {
    id: training.id,
    status: training.status, // 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    version: training.version,
    output: training.output,
    error: training.error,
    logs: training.logs,
    metrics: training.metrics,
  };
}

// 학습된 모델로 이미지 생성
export async function generateWithLoRA(params: {
  modelUrl: string; // 학습된 LoRA 모델 URL (owner/model:version)
  prompt: string;
  triggerWord?: string;
  numOutputs?: number;
}) {
  const apiToken = process.env.REPLICATE_API_TOKEN;

  // 트리거 워드가 프롬프트에 없으면 추가
  let finalPrompt = params.prompt;
  if (params.triggerWord && !params.prompt.includes(params.triggerWord)) {
    finalPrompt = `${params.triggerWord} ${params.prompt}`;
  }

  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: params.modelUrl.split(':')[1], // version ID만 추출
      input: {
        prompt: finalPrompt,
        num_outputs: params.numOutputs || 1,
        guidance_scale: 3,
        num_inference_steps: 28,
        output_format: 'webp',
        aspect_ratio: '1:1',
      },
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.detail || '이미지 생성 실패');
  }

  return await res.json();
}
