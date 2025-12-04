# Mojilab - AI 이모티콘 생성 서비스

AI 기반 커스텀 이모티콘 및 스티커 생성 플랫폼

---

## 1. 🎯 프로젝트 개요

### 1.1. 프로젝트 주제
- **AI 기반 캐릭터 이모티콘 자동 생성 서비스**
- Google Gemini API를 활용한 참조 이미지 기반 이모티콘 세트 생성

### 1.2. 제작 배경 (해결하고자 하는 문제)
- 개인 크리에이터나 소규모 사업자가 고유한 캐릭터 이모티콘을 제작하는 데 전문 디자인 기술과 많은 시간이 필요함
- 기존 AI 이미지 생성 도구는 일관된 캐릭터 스타일 유지가 어렵고, 이모티콘 특화 기능이 부족함

### 1.3. 핵심 목표 (제공하는 가치)
1. **스타일 일관성 유지**: 참조 이미지를 기반으로 동일한 캐릭터 스타일의 다양한 감정 표현 생성
2. **사용자 테마 기반 이모티콘 생성**: 사용자가 입력한 테마/키워드에 맞는 커스텀 이모티콘 세트 생성
3. **GIF 애니메이션 지원**: 움직이는 이모티콘(반짝임, 흔들림, 통통 튀기) 생성 기능
4. **배경 자동 제거**: Replicate rembg를 활용한 투명 배경 처리

---

## 2. 🛠️ 기술 스택 (Tech Stack)

| 구분 | 기술 |
| :--- | :--- |
| **Frontend** | Next.js 14, React 18, TypeScript, Tailwind CSS |
| **Backend** | Next.js API Routes, Supabase |
| **Database** | Supabase (PostgreSQL) |
| **Storage** | Supabase Storage |
| **AI / ML** | Google Gemini 2.5 Flash Image API, Replicate (rembg) |
| **Image Processing** | Sharp, gifenc |
| **Authentication** | Supabase Auth |
| **Infra / Tools** | Git, Vercel |

---

## 3. 🚀 시작하기 (Getting Started)

### 3.1. 개발 환경
- **Node.js 버전**: 18.x 이상
- **패키지 매니저**: npm
- **주요 의존성**: `package.json` 참조

### 3.2. 설치 및 실행
1.  **레포지토리 복제**
    ```bash
    git clone https://github.com/KernelAcademy-AICamp/ai-camp-1st-llm-agent-service-project-mojilab.git
    cd ai-camp-1st-llm-agent-service-project-mojilab
    ```

2.  **의존성 설치**
    ```bash
    npm install
    ```

3.  **환경 변수 설정**
    `.env.example` 파일을 복사하여 `.env.local` 파일을 생성하고, 필요한 API Key를 입력합니다.
    ```bash
    cp .env.example .env.local
    ```

    필요한 환경 변수:
    - `NEXT_PUBLIC_SUPABASE_URL`: Supabase 프로젝트 URL
    - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase 익명 키
    - `SUPABASE_SERVICE_ROLE_KEY`: Supabase 서비스 역할 키
    - `GEMINI_API_KEY`: Google Gemini API 키
    - `REPLICATE_API_TOKEN`: Replicate API 토큰

4.  **개발 서버 실행**
    ```bash
    npm run dev
    ```

    브라우저에서 `http://localhost:3000` 접속

5.  **프로덕션 빌드**
    ```bash
    npm run build
    npm start
    ```

---

## 4. 🌳 레포지토리 구조

```
/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   │   └── emoticons/     # 이모티콘 생성 API
│   │       ├── create-gif/           # GIF 애니메이션 생성
│   │       ├── generate/             # 테마 기반 이모티콘 생성
│   │       ├── generate-simple/      # 간단 이모티콘 생성
│   │       └── save/                 # 이모티콘 저장
│   ├── editor/            # 이모티콘 에디터 페이지
│   ├── series/            # 시리즈 관리 페이지
│   └── page.tsx           # 메인 페이지
│
├── components/            # React 컴포넌트
├── contexts/              # React Context (Auth, Generation)
├── lib/                   # 유틸리티 함수
│
├── .env.example           # 환경 변수 템플릿
├── package.json           # Node.js 의존성
└── README.md              # 프로젝트 소개 문서
```

---

## 5. 🔐 보안 가이드라인

1. **환경 변수**: API Key, DB 접속 정보 등 민감 정보는 `.env.local` 파일에 저장하며, 절대로 Git에 커밋하지 않습니다.
2. **인증**: API 엔드포인트는 Supabase Auth 토큰 검증을 통해 보호됩니다.

---

## 6. 주요 기능

### 6.1. 이모티콘 생성
- **테마 기반 생성**: 사용자가 입력한 테마(예: "카페", "운동", "공부")에 맞는 이모티콘 세트 생성
- **참조 이미지 기반**: 업로드한 캐릭터 이미지 스타일 유지
- **배경 자동 제거**: 투명 배경 PNG 출력

### 6.2. GIF 애니메이션
- **반짝임 (Sparkle)**: 크기 변화와 밝기 효과
- **흔들림 (Shake)**: 좌우 틸트 애니메이션
- **통통 튀기 (Bounce)**: 위아래 점프 효과
- **커스텀 액션**: 사용자 정의 애니메이션

### 6.3. 시리즈 관리
- 생성된 이모티콘 시리즈 저장 및 관리
- 이모티콘 개별 편집 기능
- 다운로드 및 공유 기능

---

## 7. 🏁 최종 결과물

1. **웹 서비스**: AI 기반 이모티콘 생성 플랫폼
2. **핵심 기능**:
   - Gemini API 기반 이미지 생성
   - 사용자 테마 기반 커스텀 이모티콘 생성
   - GIF 애니메이션 생성
   - 배경 자동 제거
3. **인증 시스템**: Supabase Auth 기반 사용자 인증
4. **데이터 저장**: Supabase Storage 기반 이미지 저장
