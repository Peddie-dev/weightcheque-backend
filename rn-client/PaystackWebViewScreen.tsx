/**
 * PaystackWebViewScreen.tsx
 *
 * Copy this file into src/screens/PaystackWebViewScreen.tsx in the React Native project.
 * Add to your root stack navigator:
 *
 *   <Stack.Screen name="PaystackWebView" component={PaystackWebViewScreen} />
 *
 * Navigate to it with:
 *   navigation.navigate('PaystackWebView', { authorizationUrl, reference, planLabel })
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { subscriptionApi } from '../api/apiService';

type PaystackParams = {
  PaystackWebView: {
    authorizationUrl: string;
    reference: string;
    planLabel: string;
  };
};

export default function PaystackWebViewScreen() {
  const insets    = useSafeAreaInsets();
  const navigation = useNavigation();
  const route      = useRoute<RouteProp<PaystackParams, 'PaystackWebView'>>();
  const { authorizationUrl, reference, planLabel } = route.params;

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const SUCCESS_URL = 'yourapp.com/subscription/success';
  const CANCEL_URL  = 'yourapp.com/subscription/cancel';

  const handleNavChange = async (navState: WebViewNavigation) => {
    const url = navState.url ?? '';

    // Paystack redirects to callback_url which then redirects to APP_URL/subscription/success
    if (url.includes(SUCCESS_URL) || url.includes('reference=') && url.includes('trxref=')) {
      setVerifying(true);
      try {
        await subscriptionApi.verify(reference);
        navigation.goBack();
        // Small delay so GoBack animates before showing alert
        setTimeout(() => {
          Alert.alert('🎉 Welcome to Premium!', `Your ${planLabel} plan is now active.`, [{ text: 'Great!' }]);
        }, 400);
      } catch {
        Alert.alert('Verification Failed', 'Payment was received but verification failed. Contact support if this persists.', [{ text: 'OK' }]);
        navigation.goBack();
      } finally {
        setVerifying(false);
      }
      return;
    }

    if (url.includes(CANCEL_URL)) {
      navigation.goBack();
    }
  };

  if (verifying) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#fea928" />
        <Text style={styles.verifyText}>Verifying payment...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>✕ Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscribe — {planLabel}</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Loading bar */}
      {loading && (
        <View style={styles.loadingBar}>
          <ActivityIndicator size="small" color="#fea928" />
          <Text style={styles.loadingText}>Loading payment page...</Text>
        </View>
      )}

      <WebView
        source={{ uri: authorizationUrl }}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={handleNavChange}
        startInLoadingState={false}
        style={styles.webview}
        // Allow Paystack redirects
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#fff' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  cancelBtn:   { width: 80 },
  cancelText:  { color: '#fea928', fontWeight: '600', fontSize: 14 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', flex: 1 },
  loadingBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#fff9f0' },
  loadingText: { fontSize: 13, color: '#ed8900' },
  webview:     { flex: 1 },
  verifyText:  { fontSize: 16, color: '#1a1a1a', marginTop: 12 },
});
