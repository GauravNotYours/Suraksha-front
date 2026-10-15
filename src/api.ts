import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:10000').replace(/\/+$/, '');
const TOKEN_KEY = 'suraksha_auth_token';

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function request<T>(path: string, options: {
  method?: string; body?: unknown; auth?: boolean;
} = {}): Promise<T> {
  const token = options.auth === false ? null : await getToken();
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new Error(`Could not reach the Suraksha server at ${API_URL}. Check the API URL and network connection.`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

export interface User {
  id: string; name: string; email: string; phone: string; bloodType?: string; medicalNotes?: string;
}
export interface Contact {
  _id: string; name: string; phone: string; relationship: string; isPrimary: boolean;
  notifyOnSOS: boolean; notifyOnMissedCheckIn: boolean;
}
export interface Point { lat: number; lng: number; accuracyMeters?: number }
export interface Service {
  id: string; name: string; type: string; phone: string; address: string; details: string;
  isOpen24x7: boolean; distanceKm: number;
}
export interface Journey {
  _id: string; origin: string; destination: string; status: string; nextCheckInAt: string;
  checkInIntervalMinutes: number; escalationLevel: number; trustedContact?: Contact;
  checkInsCompleted?: number; expectedArrivalAt: string;
}
export interface Emergency { _id: string; status: string; coordinates?: Point; activatedAt: string; shareUrl?: string }
