import { DeviceType, OS } from '../types';

const ADJECTIVES = [
  'Aura', 'Solar', 'Nova', 'Cosmic', 'Pulse', 'Hyper', 'Quantum', 'Zenith', 'Phantom', 'Prism', 'Orbit', 'Vortex'
];

const COLORS = [
  '#0A84FF', // Apple Blue
  '#5E5CE6', // Apple Indigo
  '#BF5AF2', // Apple Purple
  '#FF375F', // Apple Pink
  '#32D74B', // Apple Neon Green
  '#64D2FF', // Apple Cyan
  '#FF9F0A', // Apple Orange
  '#FFD60A', // Apple Yellow
];

export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'dev_ssr';
  }
  try {
    let id = localStorage.getItem('flick_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('flick_device_id', id);
    }
    return id;
  } catch (e) {
    return 'dev_temp_' + Math.random().toString(36).substring(2, 10);
  }
}

export function detectDevice(): { deviceId: string; deviceType: DeviceType; os: OS; defaultName: string; color: string } {
  if (typeof window === 'undefined') {
    return {
      deviceId: 'dev_ssr',
      deviceType: 'desktop',
      os: 'unknown',
      defaultName: 'Flick Node',
      color: COLORS[0],
    };
  }

  const ua = navigator.userAgent.toLowerCase();
  let deviceType: DeviceType = 'desktop';
  let os: OS = 'unknown';

  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android/i.test(ua)) {
    deviceType = 'mobile';
  }

  if (/macintosh|mac os x/i.test(ua) && !/ipad|iphone/i.test(ua)) {
    os = 'macos';
  } else if (/windows/i.test(ua)) {
    os = 'windows';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'ios';
  } else if (/android/i.test(ua)) {
    os = 'android';
  } else if (/linux/i.test(ua)) {
    os = 'linux';
  }

  // Check saved custom name in localStorage
  let savedName: string | null = null;
  try {
    savedName = localStorage.getItem('flick_device_name');
  } catch (e) {}

  const randomAdj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const randomColor = COLORS[Math.floor(Math.random() * COLORS.length)];

  let deviceLabel = 'Device';
  if (os === 'macos') deviceLabel = 'Mac';
  else if (os === 'ios' && deviceType === 'tablet') deviceLabel = 'iPad';
  else if (os === 'ios') deviceLabel = 'iPhone';
  else if (os === 'windows') deviceLabel = 'PC';
  else if (os === 'android') deviceLabel = 'Android';
  else if (os === 'linux') deviceLabel = 'Linux';

  const defaultName = savedName || `${randomAdj} ${deviceLabel}`;
  const deviceId = getDeviceId();

  return {
    deviceId,
    deviceType,
    os,
    defaultName,
    color: randomColor,
  };
}
