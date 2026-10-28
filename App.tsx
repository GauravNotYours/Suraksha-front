import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, AppState, Easing, Linking, Modal, Platform, Pressable, ScrollView, Share,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { API_URL, AlertDelivery, Contact, Emergency, Journey, Point, Service, User, request, requestArray, setToken } from './src/api';

type Tab = 'Home' | 'SOS' | 'Journey' | 'Contacts' | 'Alerts' | 'History' | 'Profile';
type FormState = { title: string; fields: { key: string; label: string; secure?: boolean; keyboard?: 'default' | 'email-address' | 'phone-pad' | 'number-pad' }[]; onSubmit: (values: Record<string, string>) => Promise<void> };

const palette = { ink: '#241512', muted: '#77645f', paper: '#fffaf7', accent: '#a32719', gold: '#f3b844', border: '#eaded6', green: '#247a51', red: '#b42318' };
const emergencyAlertSound = require('./assets/emergency-alert.wav');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function getNotificationUrl(response: Notifications.NotificationResponse | null) {
  const data = response?.notification?.request?.content?.data;
  if (!data || typeof data !== 'object' || !('url' in data)) return null;
  if (typeof data.url !== 'string' || data.url.length === 0) return null;
  try {
    const url = new URL(data.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function App() {
  return <SafeAreaProvider><AppContent /></SafeAreaProvider>;
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('Home');
  const [location, setLocation] = useState<Point | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [emergency, setEmergency] = useState<Emergency | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [smsSetup, setSmsSetup] = useState<{ configured: boolean; missingEnvironmentVariables: string[] } | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [pushStatus, setPushStatus] = useState('Push notifications are not enabled on this device.');
  const [pushDeviceToken, setPushDeviceToken] = useState<string | null>(null);
  const [soundAlertOn, setSoundAlertOn] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const alertPlayer = useAudioPlayer(emergencyAlertSound);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const horizontalPadding = width < 360 ? 14 : width < 600 ? 18 : 28;
  const screenTransition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    screenTransition.setValue(0);
    Animated.timing(screenTransition, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [tab, screenTransition]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setSoundAlertOn(Boolean(emergency && emergency.status === 'ACTIVE'));
  }, [emergency?._id, emergency?.status]);

  useEffect(() => {
    if (!emergency || emergency.status !== 'ACTIVE' || !soundAlertOn || appState !== 'active') {
      alertPlayer.pause();
      if (!emergency || emergency.status !== 'ACTIVE') setSoundAlertOn(false);
      return;
    }

    let cancelled = false;
    setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).then(() => {
      if (cancelled) return;
      alertPlayer.loop = true;
      alertPlayer.volume = 0.7;
      alertPlayer.play();
    }).catch((error) => {
      if (cancelled) return;
      setSoundAlertOn(false);
      Alert.alert('Sound alert unavailable', error instanceof Error ? error.message : 'Audio could not be started.');
    });

    return () => {
      cancelled = true;
      alertPlayer.pause();
    };
  }, [emergency?._id, emergency?.status, soundAlertOn, appState, alertPlayer]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const profile = await request<User>('/auth/me');
        if (mounted) {
          setUser(profile);
          await refresh();
        }
      } catch {
        await setToken(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const locate = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new Error('Location permission is required for this safety feature.');
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const point = { lat: current.coords.latitude, lng: current.coords.longitude, accuracyMeters: current.coords.accuracy || undefined };
    setLocation(point);
    return point;
  }, []);

  const refresh = useCallback(async () => {
    const [contactRows, activeJourney, activeEmergency, historyRows, notificationRows, smsConfiguration] = await Promise.all([
      requestArray<Contact>('/contacts'),
      request<Journey | null>('/journeys/active'),
      request<Emergency | null>('/emergency/active'),
      requestArray<any>('/journeys/history'),
      requestArray<any>('/notifications'),
      request<{ configured: boolean; missingEnvironmentVariables: string[] }>('/sms/status'),
    ]);
    setContacts(contactRows);
    setJourney(activeJourney);
    setEmergency(activeEmergency);
    setHistory(historyRows);
    setNotifications(notificationRows);
    setSmsSetup(smsConfiguration);
    try {
      const point = await locate();
      const serviceRows = await requestArray<Service>('/services/nearby', { method: 'POST', body: point });
      setServices(serviceRows);
    } catch (error) {
      console.warn('Location refresh failed:', error);
    }
  }, [locate]);

  useEffect(() => {
    const journeyActive = journey && ['ACTIVE', 'MISSED_CHECKIN'].includes(journey.status);
    const emergencyActive = emergency && emergency.status === 'ACTIVE';
    if (!user || (!journeyActive && !emergencyActive)) return;

    let active = true;
    const updateLiveLocation = async () => {
      try {
        const point = await locate();
        if (!active) return;
        const updates: Promise<unknown>[] = [];
        if (journeyActive && journey) {
          updates.push(request(`/journeys/${journey._id}/location`, { method: 'PUT', body: { currentLocation: point } }));
        }
        if (emergencyActive && emergency) {
          updates.push(request(`/emergency/${emergency._id}/location`, { method: 'PUT', body: { coordinates: point } }));
        }
        await Promise.all(updates);
      } catch (error) {
        console.warn('Live location update failed:', error);
      }
    };

    updateLiveLocation();
    const timer = setInterval(updateLiveLocation, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, journey?._id, journey?.status, emergency?._id, emergency?.status, locate]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      refresh().catch((error) => console.warn('Refresh failed:', error));
    }, 30000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  const submitLogin = async (values: Record<string, string>) => {
    const result = await request<{ user: User; token: string }>('/auth/login', {
      method: 'POST', auth: false, body: { identifier: values.identifier, password: values.password },
    });
    await setToken(result.token);
    setUser(result.user);
    setForm(null);
    await refresh();
  };

  const showAuth = (register: boolean) => setForm({
    title: register ? 'Create your account' : 'Sign in',
    fields: register ? [
      { key: 'name', label: 'Full name' }, { key: 'email', label: 'Email', keyboard: 'email-address' },
      { key: 'phone', label: 'Phone number', keyboard: 'phone-pad' }, { key: 'password', label: 'Password (8+ characters)', secure: true },
      { key: 'emergencyPin', label: 'Emergency PIN (4 digits)', secure: true, keyboard: 'number-pad' },
    ] : [
      { key: 'identifier', label: 'Email or phone' }, { key: 'password', label: 'Password', secure: true },
    ],
    onSubmit: async (values) => {
      if (!register) return submitLogin(values);
      const result = await request<{ user: User; token: string }>('/auth/register', { method: 'POST', auth: false, body: values });
      await setToken(result.token);
      setUser(result.user);
      setForm(null);
      await refresh();
    },
  });

  const withBusy = async (action: () => Promise<void>) => {
    try { setBusy(true); await action(); }
    catch (error) { Alert.alert('Could not complete action', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  };

  const registerPushNotifications = useCallback(async (requestPermission = false) => {
    if (!Device.isDevice || Platform.OS !== 'android') {
      setPushStatus('Firebase push setup currently requires a physical Android device.');
      return;
    }

    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && requestPermission) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== 'granted') {
      setPushStatus('Notification permission is not enabled. Allow notifications in device settings.');
      return;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('emergency-sound-v1', {
        name: 'Emergency alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#A32719',
      });
    }

    const deviceToken = await Notifications.getDevicePushTokenAsync();
    if (typeof deviceToken.data !== 'string' || deviceToken.data.length < 20) {
      throw new Error('Android did not return a valid Firebase push token. Reinstall the Firebase-configured APK and try again.');
    }
    await request('/devices/register', {
      method: 'POST',
      body: { token: deviceToken.data, platform: 'android' },
    });
    setPushDeviceToken(deviceToken.data);
    const backendPush = await request<{ configured: boolean; missingEnvironmentVariables: string[] }>('/push/status');
    setPushStatus(backendPush.configured
      ? 'Push alerts are enabled on this device.'
      : `Device registered; backend Firebase setup is missing: ${backendPush.missingEnvironmentVariables.join(', ')}.`);
  }, []);

  useEffect(() => {
    if (!user) return;
    registerPushNotifications(true).catch((error) => {
      setPushStatus(error instanceof Error ? error.message : 'Could not register this device for push alerts.');
    });
  }, [user?.id, registerPushNotifications]);

  useEffect(() => {
    const openAlertLocation = (response: Notifications.NotificationResponse | null) => {
      const url = getNotificationUrl(response);
      if (url) {
        Linking.openURL(url).catch((error) => Alert.alert('Could not open location', String(error)));
      }
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(openAlertLocation);
    Notifications.getLastNotificationResponseAsync().then(openAlertLocation).catch((error) => {
      console.warn('Could not read notification response:', error);
    });
    return () => subscription.remove();
  }, []);

  const triggerSOS = async (source: 'SOS' | 'VOICE' = 'SOS') => withBusy(async () => {
    let point: Point | undefined;
    let locationIssue = '';
    try {
      point = await locate();
    } catch (error) {
      locationIssue = error instanceof Error ? error.message : 'GPS location is unavailable.';
    }
    const active = await request<Emergency>('/emergency/sos', { method: 'POST', body: { ...(point ? { coordinates: point } : {}), source } });
    setEmergency(active);
    const deliveryStatus = Array.isArray(active.contactsNotified) && active.contactsNotified.length
      ? `\n\nContact alerts:\n${active.contactsNotified.map(formatAlertDelivery).join('\n')}`
      : '\n\nNo trusted contacts are enabled for SOS alerts. Add or enable a contact in Contacts.';
    Alert.alert('SOS activated', `${point ? 'Your alert includes GPS coordinates.' : `Your alert was recorded without GPS. ${locationIssue}`}${deliveryStatus}`);
    await refresh();
  });

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript?.toLowerCase() || '';
    if (voiceOn && (transcript.includes('suraksha help') || transcript.includes('suraksha sos'))) {
      ExpoSpeechRecognitionModule.stop();
      setVoiceOn(false);
      triggerSOS('VOICE').catch((error) => Alert.alert('Voice SOS failed', String(error)));
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    setVoiceOn(false);
    Alert.alert('Voice SOS stopped', event.message || 'Speech recognition could not continue.');
  });

  const startVoice = async () => {
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) throw new Error('Microphone and speech recognition permissions are needed.');
    setVoiceOn(true);
    ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true, continuous: true });
  };

  const startJourney = async () => {
    if (!contacts.length) { Alert.alert('Add a trusted contact first', 'A safety journey needs a contact who can be notified.'); setTab('Contacts'); return; }
    const point = await locate();
    setForm({
      title: 'Start a safety journey',
      fields: [
        { key: 'destination', label: 'Destination' },
        { key: 'estimatedMinutes', label: 'Expected travel time in minutes', keyboard: 'number-pad' },
        { key: 'checkInIntervalMinutes', label: 'Check-in interval in minutes', keyboard: 'number-pad' },
      ],
      onSubmit: async (values) => {
        await request('/journeys', { method: 'POST', body: {
          origin: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
          destination: values.destination, estimatedMinutes: Number(values.estimatedMinutes),
          checkInIntervalMinutes: Number(values.checkInIntervalMinutes) || 5,
          trustedContactId: contacts.find((contact) => contact.isPrimary)?._id || contacts[0]._id,
          currentLocation: point,
        } });
        setForm(null);
        await refresh();
        setTab('Journey');
      },
    });
  };

  const addContact = () => setForm({
    title: 'Add trusted contact',
    fields: [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone number', keyboard: 'phone-pad' }, { key: 'relationship', label: 'Relationship' }],
    onSubmit: async (values) => {
      await request('/contacts', { method: 'POST', body: { ...values, isPrimary: contacts.length === 0, notifyOnSOS: true, notifyOnMissedCheckIn: true } });
      setForm(null);
      await refresh();
    },
  });

  const cancelEmergency = () => setForm({
    title: 'Resolve SOS with your PIN',
    fields: [{ key: 'pin', label: '4-digit emergency PIN', secure: true, keyboard: 'number-pad' }],
    onSubmit: async ({ pin }) => {
      await request(`/emergency/${emergency?._id}/cancel`, { method: 'POST', body: { pin } });
      setForm(null);
      await refresh();
    },
  });

  const call = async (phone: string) => {
    const number = phone.replace(/[^\d+]/g, '');
    if (number) await Linking.openURL(`tel:${number}`);
  };

  const createJourneyAction = async (path: string) => {
    if (!journey) return;
    await request(`/journeys/${journey._id}/${path}`, { method: 'POST', body: location ? { currentLocation: location } : {} });
    await refresh();
  };

  const logout = async () => {
    try {
      if (pushDeviceToken) {
        await request('/devices/register', { method: 'DELETE', body: { token: pushDeviceToken } });
      }
    } finally {
      await setToken(null);
      setPushDeviceToken(null);
      setUser(null);
      setTab('Home');
      setJourney(null);
      setEmergency(null);
    }
  };
  const mainServices = useMemo(() => services.slice(0, 4), [services]);

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color={palette.accent} /><Text style={styles.muted}>Connecting to Suraksha…</Text></SafeAreaView>;
  if (!user) return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><ScrollView contentContainerStyle={[styles.auth, { paddingBottom: Math.max(insets.bottom, 16) }]} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>सुरक्षा</Text><Text style={styles.title}>Suraksha</Text>
    <Text style={styles.muted}>Your personal safety companion. Connect to the configured API to sign in or create your account.</Text>
    <Text style={styles.endpoint}>API: {API_URL}</Text>
    <Button title="Sign in" onPress={() => showAuth(false)} />
    <Button title="Create account" kind="outline" onPress={() => showAuth(true)} />
  </ScrollView>{renderForm(form, setForm, withBusy)}</SafeAreaView>;

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.top}><View><Text style={styles.brand}>सुरक्षा</Text><Text style={styles.subbrand}>PERSONAL SAFETY</Text></View><Pressable onPress={() => withBusy(refresh)}><Text style={styles.refresh}>↻</Text></Pressable></View>
    {emergency && <Pressable style={styles.activeBanner} onPress={() => setTab('SOS')}><Text style={styles.bannerText}>SOS ACTIVE · Open emergency details</Text></Pressable>}
    <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: horizontalPadding }]} keyboardShouldPersistTaps="handled">
      <Animated.View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', opacity: screenTransition, transform: [{ translateY: screenTransition.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      {tab === 'Home' && <View>
        <Text style={styles.eyebrow}>WELCOME BACK</Text><Text style={styles.h1}>{user.name}</Text>
        <View style={styles.sosHomeBlock}>
          <Text style={styles.sectionTitle}>Need help now?</Text>
          {emergency
            ? <><Text style={styles.muted}>An SOS incident is already active.</Text><Button title="View active SOS" kind="outline" onPress={() => setTab('SOS')} /></>
            : <><Text style={styles.muted}>Press and hold SOS to send your current location to your trusted contacts.</Text><SosButton size={Math.min(200, Math.max(148, width - horizontalPadding * 4))} onTrigger={() => triggerSOS()} /></>}
        </View>
        {journey ? <Card><Text style={styles.sectionTitle}>Journey in progress</Text><Text style={styles.body}>To {journey.destination} · check-in due {new Date(journey.nextCheckInAt).toLocaleTimeString()}</Text><Button title="I'm safe — check in" onPress={() => withBusy(() => createJourneyAction('checkin'))} /></Card> : <Button title="Start a safety journey" onPress={() => withBusy(startJourney)} />}
        <Text style={styles.sectionTitle}>Quick actions</Text><View style={styles.row}><SmallAction title="Open SOS details" onPress={() => setTab('SOS')} danger /><SmallAction title="Trusted contacts" onPress={() => setTab('Contacts')} /></View>
        <Text style={styles.sectionTitle}>Nearby help</Text>{mainServices.map((service) => <ServiceCard key={service.id} service={service} onCall={call} />)}
        {!mainServices.length && <Text style={styles.muted}>No service records found. Check location permission and seed verified service records into MongoDB.</Text>}
      </View>}
      {tab === 'SOS' && <View><Text style={styles.eyebrow}>EMERGENCY</Text><Text style={styles.h1}>SOS alert</Text><Text style={styles.body}>Press and hold for 2 seconds to record an SOS with your current GPS coordinates and notify your opted-in trusted contacts.</Text>
        {!contacts.some((contact) => contact.notifyOnSOS) && <Card><Text style={styles.warning}>No contacts are opted in for SOS alerts. Add a trusted contact so the app can notify them.</Text><Button title="Add trusted contact" kind="outline" onPress={() => setTab('Contacts')} /></Card>}
        {emergency ? <Card><Text style={styles.sectionTitle}>Active incident</Text><Text style={styles.body}>Reference: {emergency._id}</Text><Text style={styles.body}>Status: {emergency.status}</Text><Text style={styles.body}>{emergency.coordinates ? `${emergency.coordinates.lat.toFixed(5)}, ${emergency.coordinates.lng.toFixed(5)}` : 'Waiting for a GPS update'}</Text><Button title={soundAlertOn ? 'Silence emergency sound' : 'Resume emergency sound'} kind={soundAlertOn ? 'outline' : 'solid'} onPress={() => setSoundAlertOn((enabled) => !enabled)} /><Text style={styles.muted}>Emergency sound starts automatically while this alert is active and the app is open. Tap to silence or resume.</Text>{emergency.shareUrl && <Button title="Share live location link" kind="outline" onPress={() => Share.share({ message: emergency.shareUrl! })} />}<Button title="Resolve with emergency PIN" kind="outline" onPress={cancelEmergency} /></Card> :
          <SosButton size={Math.min(220, Math.max(160, width - horizontalPadding * 3))} onTrigger={() => triggerSOS()} />}
        <Button title="Call emergency number 112" kind="outline" onPress={() => call('112')} />
        <Card><Text style={styles.sectionTitle}>Optional voice SOS</Text><Text style={styles.body}>When enabled and the app is open, say “Suraksha help” or “Suraksha SOS”. Speech is processed by your device's speech recognition provider.</Text><Button title={voiceOn ? 'Stop voice listening' : 'Enable voice SOS'} kind="outline" onPress={() => withBusy(async () => { if (voiceOn) { ExpoSpeechRecognitionModule.stop(); setVoiceOn(false); } else await startVoice(); })} /></Card>
        <Text style={styles.muted}>Call emergency services directly if you need immediate dispatch. SOS activation does not itself contact government responders.</Text>
      </View>}
      {tab === 'Journey' && <View><Text style={styles.eyebrow}>SAFETY CHECK-IN</Text><Text style={styles.h1}>Safe journey</Text>
        {journey ? <Card><Text style={styles.sectionTitle}>{journey.destination}</Text><Text style={styles.body}>Status: {journey.status} · escalation level {journey.escalationLevel}</Text><Text style={styles.body}>Next check-in: {new Date(journey.nextCheckInAt).toLocaleString()}</Text><Text style={styles.body}>Trusted contact: {journey.trustedContact?.name || 'Selected contact'}</Text><Button title="I'm safe — check in" onPress={() => withBusy(() => createJourneyAction('checkin'))} /><Button title="I arrived safely" kind="outline" onPress={() => withBusy(() => createJourneyAction('complete'))} /><Button title="Cancel journey" kind="outline" onPress={() => withBusy(() => createJourneyAction('cancel'))} /></Card> :
          <><Text style={styles.muted}>Set your destination and check-in timing. If you miss a check-in, the server first alerts your selected contact and escalates if you remain unresponsive.</Text><Button title="Start a monitored journey" onPress={() => withBusy(startJourney)} /></>}
      </View>}
      {tab === 'Contacts' && <View><Text style={styles.eyebrow}>YOUR SAFETY NETWORK</Text><Text style={styles.h1}>Trusted contacts</Text><Text style={styles.muted}>Push alerts work when the contact has Suraksha installed, has enabled push notifications, and has registered with the same phone number saved here. SMS is only a fallback.</Text>
        <Card><Text style={styles.sectionTitle}>Push-first alerts · SMS fallback</Text><Text style={styles.smsOkay}>Push notifications can include the emergency live-location link without an SMS provider.</Text><Text style={smsSetup?.configured ? styles.muted : styles.warning}>{smsSetup?.configured ? 'Twilio SMS fallback is configured.' : `SMS fallback is unavailable. Missing: ${smsSetup?.missingEnvironmentVariables.join(', ') || 'checking status'}.`}</Text></Card>
        <Button title="+ Add contact" onPress={addContact} />
        {contacts.map((contact) => <Card key={contact._id}><Text style={styles.sectionTitle}>{contact.name}{contact.isPrimary ? ' · PRIMARY' : ''}</Text><Text style={styles.body}>{contact.relationship} · {contact.phone}</Text><Text style={styles.muted}>SOS: {contact.notifyOnSOS ? 'On' : 'Off'} · missed check-in: {contact.notifyOnMissedCheckIn ? 'On' : 'Off'}</Text><View style={styles.row}><SmallAction title="Call" onPress={() => call(contact.phone)} /><SmallAction title="Test push" onPress={() => withBusy(async () => { const result = await request<{ message: string; status: string }>(`/contacts/${contact._id}/test-push`, { method: 'POST' }); await refresh(); Alert.alert(`Push ${result.status}`, result.message); })} /><SmallAction title="Test SMS" onPress={() => withBusy(async () => { const result = await request<{ message: string; status: string }>(`/contacts/${contact._id}/test-ping`, { method: 'POST' }); await refresh(); Alert.alert(`SMS ${result.status}`, result.message); })} /><SmallAction title="Delete" onPress={() => Alert.alert('Delete contact?', `Remove ${contact.name}?`, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => withBusy(async () => { await request(`/contacts/${contact._id}`, { method: 'DELETE' }); await refresh(); }) }])} /></View></Card>)}
      </View>}
      {tab === 'Alerts' && <View>
        <Text style={styles.eyebrow}>DELIVERY ACTIVITY</Text><Text style={styles.h1}>Alert history</Text>
        <Text style={styles.muted}>Push and SMS delivery attempts to your trusted contacts appear here.</Text>
        {notifications.map((notification) => <Card key={notification._id}>
          <Text style={styles.sectionTitle}>{notification.channel || 'Alert'} {notification.status}</Text>
          <Text style={styles.body}>{notification.error || notification.providerStatus || 'Delivery status recorded by the backend.'}</Text>
          <Text style={styles.muted}>{new Date(notification.createdAt).toLocaleString()}</Text>
        </Card>)}
        {!notifications.length && <Text style={styles.muted}>No contact alerts have been recorded yet.</Text>}
      </View>}
      {tab === 'History' && <View><Text style={styles.eyebrow}>PAST JOURNEYS</Text><Text style={styles.h1}>Safety history</Text>{history.map((item) => <Card key={item.id}><Text style={styles.sectionTitle}>{item.destination}</Text><Text style={styles.body}>{item.status} · {item.checkInsCompleted} check-ins</Text><Text style={styles.muted}>{new Date(item.date).toLocaleString()}</Text></Card>)}{!history.length && <Text style={styles.muted}>Completed journeys will appear here.</Text>}</View>}
      {tab === 'Profile' && <View><Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.h1}>Your profile</Text><Card><Text style={styles.sectionTitle}>{user.name}</Text><Text style={styles.body}>{user.email}</Text><Text style={styles.body}>{user.phone}</Text><Text style={styles.body}>Blood type: {user.bloodType || 'Not added'}</Text><Text style={styles.body}>Medical notes: {user.medicalNotes || 'Not added'}</Text></Card><Card><Text style={styles.sectionTitle}>Trusted-contact push alerts</Text><Text style={styles.muted}>{pushStatus}</Text><Button title="Enable / refresh push alerts" onPress={() => withBusy(() => registerPushNotifications(true))} /></Card><Text style={styles.muted}>Backend: {API_URL}</Text><Button title="Sign out" kind="outline" onPress={() => withBusy(logout)} /></View>}
      </Animated.View>
    </ScrollView>
    <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 6) }]}>{(['Home', 'SOS', 'Journey', 'Contacts', 'Alerts', 'History', 'Profile'] as Tab[]).map((name) => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={[styles.navItem, tab === name && styles.navItemSelected]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.navText, tab === name && styles.navSelected, name === 'SOS' && styles.navSOS]}>{name}</Text></Pressable>)}</View>
    {busy && <View style={styles.busy}><ActivityIndicator color="#fff" /><Text style={styles.busyText}>Working…</Text></View>}
    {renderForm(form, setForm, withBusy)}
  </SafeAreaView>;
}

function renderForm(form: FormState | null, setForm: (form: FormState | null) => void, withBusy: (action: () => Promise<void>) => Promise<void>) {
  if (!form) return null;
  return <Modal transparent animationType="slide" onRequestClose={() => setForm(null)}><View style={styles.modalShade}><ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modal}>
    <Text style={styles.sectionTitle}>{form.title}</Text>
    <FormInputs form={form} setForm={setForm} withBusy={withBusy} />
    <Pressable onPress={() => setForm(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable>
  </ScrollView></View></Modal>;
}

function FormInputs({ form, setForm, withBusy }: { form: FormState; setForm: (form: FormState | null) => void; withBusy: (action: () => Promise<void>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return <View>
    {form.fields.map((field) => <TextInput key={field.key} style={styles.input} placeholder={field.label} placeholderTextColor={palette.muted} secureTextEntry={field.secure} keyboardType={field.keyboard || 'default'} value={values[field.key] || ''} onChangeText={(value) => setValues((old) => ({ ...old, [field.key]: value }))} autoCapitalize={field.keyboard === 'email-address' ? 'none' : 'sentences'} />)}
    <Button title="Submit" onPress={() => withBusy(async () => { await form.onSubmit(values); setForm(null); })} />
  </View>;
}

function Card({ children }: { children: React.ReactNode }) { return <View style={styles.card}>{children}</View>; }
function Button({ title, onPress, kind = 'solid' }: { title: string; onPress: () => void; kind?: 'solid' | 'outline' }) {
  return <Pressable onPress={onPress} style={[styles.button, kind === 'outline' && styles.buttonOutline]}><Text style={[styles.buttonText, kind === 'outline' && styles.buttonTextOutline]}>{title}</Text></Pressable>;
}
function SmallAction({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) {
  return <Pressable onPress={onPress} style={[styles.smallAction, danger && styles.smallDanger]}><Text style={[styles.smallText, danger && styles.smallDangerText]}>{title}</Text></Pressable>;
}

function formatAlertDelivery(delivery: AlertDelivery) {
  const channel = delivery.channel || 'SMS';
  const detail = delivery.error || delivery.providerStatus || '';
  return `${delivery.name || 'Contact'}: ${channel} ${delivery.status}${detail ? ` — ${detail}` : ''}`;
}

function ServiceCard({ service, onCall }: { service: Service; onCall: (phone: string) => void }) {
  return <Card><View style={styles.serviceHeading}><Text style={styles.sectionTitle}>{service.name}</Text><Text style={styles.distance}>{service.distanceKm} km</Text></View><Text style={styles.body}>{service.type} · {service.phone}</Text><Text style={styles.muted}>{service.address}</Text><Text style={styles.muted}>{service.details}</Text><SmallAction title={`Call ${service.phone}`} onPress={() => onCall(service.phone)} /></Card>;
}

function SosButton({ size, onTrigger }: { size: number; onTrigger: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.045, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return <Animated.View style={{ alignSelf: 'center', transform: [{ scale: pulse }] }}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to trigger an emergency SOS"
      onLongPress={onTrigger}
      delayLongPress={1500}
      style={[styles.sos, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.sosIcon, { fontSize: Math.round(size * 0.24) }]}>SOS</Text>
      <Text style={styles.sosHint}>HOLD 1.5 SECONDS</Text>
    </Pressable>
  </Animated.View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.paper }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper, gap: 12 }, auth: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 16 },
  top: { paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: palette.accent, fontSize: 25, fontWeight: '900' }, subbrand: { color: palette.muted, fontSize: 9, letterSpacing: 2, fontWeight: '800' }, refresh: { fontSize: 28, color: palette.accent },
  content: { flexGrow: 1, paddingTop: 16, paddingBottom: 26 }, eyebrow: { color: palette.accent, fontSize: 11, letterSpacing: 1.5, fontWeight: '900', marginBottom: 5 }, title: { fontSize: 36, color: palette.ink, fontWeight: '900' }, h1: { fontSize: 28, color: palette.ink, fontWeight: '900', marginBottom: 12 }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '800', marginBottom: 6 }, body: { color: palette.ink, fontSize: 14, lineHeight: 21, marginBottom: 5 }, muted: { color: palette.muted, fontSize: 13, lineHeight: 19, marginBottom: 10 }, endpoint: { color: palette.muted, fontSize: 10 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: palette.border, borderRadius: 18, padding: 16, marginVertical: 8 }, button: { minHeight: 48, backgroundColor: palette.accent, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginVertical: 6 }, buttonOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.accent }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' }, buttonTextOutline: { color: palette.accent }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, smallAction: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 8 }, smallText: { color: palette.ink, fontWeight: '700', fontSize: 12 }, smallDanger: { backgroundColor: '#fff0ef', borderColor: '#f2cbc8' }, smallDangerText: { color: palette.red }, distance: { color: palette.green, fontSize: 12, fontWeight: '800' }, serviceHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sos: { backgroundColor: palette.red, alignSelf: 'center', justifyContent: 'center', alignItems: 'center', marginVertical: 16, borderWidth: 7, borderColor: '#f1c16a', elevation: 6 }, sosHomeBlock: { backgroundColor: '#fff4f1', borderColor: '#f1d5cf', borderWidth: 1, borderRadius: 20, padding: 16, marginVertical: 10 }, sosIcon: { color: '#fff', fontWeight: '900' }, sosHint: { color: '#fff', fontWeight: '800', fontSize: 10, letterSpacing: 0.8 }, warning: { color: palette.red, marginTop: 5, fontSize: 13 }, smsOkay: { color: palette.green, fontWeight: '800', marginVertical: 6 }, activeBanner: { backgroundColor: palette.red, padding: 10 }, bannerText: { color: '#fff', textAlign: 'center', fontWeight: '900' },
  nav: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderColor: palette.border, backgroundColor: '#fff', paddingHorizontal: 2 }, navItem: { flex: 1, minWidth: 0, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1, paddingVertical: 10 }, navItemSelected: { backgroundColor: '#fff4f1', borderRadius: 10 }, navText: { color: palette.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' }, navSelected: { color: palette.accent, fontWeight: '900' }, navSOS: { color: palette.red, fontWeight: '900' }, busy: { position: 'absolute', top: '47%', alignSelf: 'center', backgroundColor: '#34231f', padding: 18, borderRadius: 14, alignItems: 'center' }, busyText: { color: '#fff', marginTop: 8 },
  modalShade: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }, modalScroll: { maxHeight: '90%' }, modal: { backgroundColor: palette.paper, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, flexGrow: 1 }, input: { borderColor: palette.border, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: palette.ink, backgroundColor: '#fff', marginVertical: 5 }, cancelText: { color: palette.muted, textAlign: 'center', padding: 12, fontWeight: '700' },
});
