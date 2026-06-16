/**
 * NutritionistChatScreen.tsx
 * Add to RootStackParamList: NutritionistChat: { conversationId: string }
 * Add to stack: <Stack.Screen name="NutritionistChat" component={NutritionistChatScreen} />
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { messagingApi } from '../api/apiService';
import { colors } from '../theme/colors';
import { radius, spacing, shadows } from '../theme/typography';

const API_URL = __DEV__ ? 'http://localhost:4000' : 'https://api.yourapp.com';

interface Message {
  id: string;
  body: string;
  senderRole: 'USER' | 'NUTRITIONIST';
  sender: { id: string; name: string };
  sentAt: string;
  readAt?: string;
}

type ChatRoute = RouteProp<{ NutritionistChat: { conversationId: string } }, 'NutritionistChat'>;

export default function NutritionistChatScreen() {
  const insets        = useSafeAreaInsets();
  const navigation    = useNavigation();
  const route         = useRoute<ChatRoute>();
  const { conversationId } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const socketRef               = useRef<Socket | null>(null);
  const flatListRef             = useRef<FlatList>(null);

  // Load message history
  useEffect(() => {
    messagingApi.getMessages(conversationId)
      .then((data: any) => setMessages(data.messages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));

    messagingApi.markRead(conversationId).catch(() => {});
  }, [conversationId]);

  // Connect socket for real-time
  useEffect(() => {
    let socket: Socket;

    (async () => {
      const token = await AsyncStorage.getItem('@wc:access_token');
      socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
      socketRef.current = socket;

      socket.emit('join_conversation', conversationId);

      socket.on('new_message', (msg: Message) => {
        setMessages((prev) => [...prev, msg]);
        scrollToBottom();
      });
    })();

    return () => {
      socket?.emit('leave_conversation', conversationId);
      socket?.disconnect();
    };
  }, [conversationId]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft('');
    try {
      const msg = await messagingApi.sendMessage(conversationId, text) as Message;
      setMessages((prev) => [...prev, msg]);
      scrollToBottom();
    } catch {
      setDraft(text); // restore on failure
    } finally {
      setSending(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMe = item.senderRole === 'USER';
    const showDate = index === 0 ||
      new Date(messages[index - 1].sentAt).toDateString() !== new Date(item.sentAt).toDateString();

    return (
      <>
        {showDate && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateSeparatorText}>
              {new Date(item.sentAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}
        <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
          {!isMe && (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>👩‍⚕️</Text>
            </View>
          )}
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            {!isMe && <Text style={styles.senderName}>{item.sender.name}</Text>}
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
            <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{formatTime(item.sentAt)}</Text>
          </View>
        </View>
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Your Nutritionist</Text>
          <Text style={styles.headerSubtitle}>Tap to view profile</Text>
        </View>
        <View style={styles.headerAvatar}>
          <Text style={{ fontSize: 22 }}>👩‍⚕️</Text>
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={[styles.messageList, { paddingBottom: insets.bottom + 80 }]}
          onLayout={scrollToBottom}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Start the conversation</Text>
              <Text style={styles.emptySubtitle}>Ask your nutritionist anything about your meal plan, goals, or progress.</Text>
            </View>
          }
        />
      )}

      {/* Input */}
      <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message your nutritionist…"
          placeholderTextColor={colors.gray400}
          multiline
          maxLength={2000}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!draft.trim() || sending}
          activeOpacity={0.85}
        >
          {sending
            ? <ActivityIndicator size="small" color={colors.white} />
            : <Text style={styles.sendIcon}>↑</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 32, color: colors.white, fontWeight: '300', lineHeight: 36 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.white },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  headerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  dateSeparator: { alignItems: 'center', marginVertical: 12 },
  dateSeparatorText: {
    fontSize: 11, color: colors.gray400, fontWeight: '500',
    backgroundColor: colors.white, paddingHorizontal: 10,
    paddingVertical: 3, borderRadius: radius.full,
  },
  messageRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end', gap: 8 },
  messageRowMe:   { justifyContent: 'flex-end' },
  messageRowThem: { justifyContent: 'flex-start' },
  avatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16 },
  bubble: {
    maxWidth: '75%', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: radius.xl, gap: 2,
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
    ...shadows.sm,
  },
  bubbleThem: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: 4,
    ...shadows.sm,
  },
  senderName: { fontSize: 11, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  bubbleText:   { fontSize: 14, color: colors.black, lineHeight: 20 },
  bubbleTextMe: { color: colors.white },
  bubbleTime:   { fontSize: 10, color: colors.gray400, alignSelf: 'flex-end', marginTop: 2 },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyEmoji:    { fontSize: 48, marginBottom: 12 },
  emptyTitle:    { fontSize: 18, fontWeight: '700', color: colors.black, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: colors.gray500, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md,
    backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  input: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: radius.xl,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
    color: colors.black, maxHeight: 100, backgroundColor: colors.gray100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.sm,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { fontSize: 20, color: colors.white, fontWeight: '700' },
});
