import type { ExpoConfig } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';
const IS_PREVIEW = process.env.APP_VARIANT === 'preview';

const bundleIdentifier = IS_DEV
  ? 'app.nhip.planner.dev'
  : IS_PREVIEW
    ? 'app.nhip.planner.preview'
    : 'app.nhip.planner';

const name = IS_DEV ? 'Nhịp (Dev)' : IS_PREVIEW ? 'Nhịp (Preview)' : 'Nhịp';

const config: ExpoConfig = {
  name,
  slug: 'nhip',
  scheme: 'nhip',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0E1116',
  ios: {
    bundleIdentifier,
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      // Background audio so lecture recording continues with the screen locked.
      UIBackgroundModes: ['audio', 'remote-notification'],
      NSMicrophoneUsageDescription:
        'Nhịp cần micro để ghi âm bài giảng và nhập việc bằng giọng nói.',
      NSCameraUsageDescription: 'Nhịp cần camera để chụp ảnh bảng, slide và tài liệu vào ghi chú.',
      NSPhotoLibraryUsageDescription: 'Nhịp cần truy cập thư viện ảnh để đính kèm ảnh vào ghi chú và việc.',
      // iOS has no Info.plist string for notifications; the Vietnamese explanation is shown
      // in-app (onboarding step 5) right before requesting permission.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-font',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0E1116',
        image: './assets/splash-icon.png',
        imageWidth: 160,
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
    'expo-apple-authentication',
    [
      'expo-audio',
      {
        microphonePermission: 'Nhịp cần micro để ghi âm bài giảng và nhập việc bằng giọng nói.',
        enableBackgroundRecording: true,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#8B7CFF',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Nhịp cần truy cập thư viện ảnh để đính kèm ảnh vào ghi chú và việc.',
        cameraPermission: 'Nhịp cần camera để chụp ảnh bảng, slide và tài liệu vào ghi chú.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
};

export default config;
