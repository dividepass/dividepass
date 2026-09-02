import { useState, useEffect, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import './GroupChat.css';

function GroupChat({ groupId }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendError, setSendError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const userCacheRef = useRef({});

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!groupId) return;

    const load = async () => {
      const { data } = await supabase
        .from('group_messages')
        .select('*, user:user_id (id, name, avatar_url)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (data) {
        data.forEach(msg => {
          if (msg.user) userCacheRef.current[msg.user.id] = msg.user;
        });
        setMessages(data);
      }
      setLoading(false);
    };

    load();

    let channel;
    const setupRealtime = () => {
      channel = supabase
        .channel(`group-chat-${groupId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        }, async (payload) => {
          const msg = payload.new;
          if (msg.user_id === user?.id) return;

          const cached = userCacheRef.current[msg.user_id];
          if (!cached) {
            const { data: userData } = await supabase
              .from('users')
              .select('id, name, avatar_url')
              .eq('id', msg.user_id)
              .single();
            if (userData) userCacheRef.current[userData.id] = userData;
            setMessages(prev => [...prev, { ...msg, user: userData || null }]);
          } else {
            setMessages(prev => [...prev, { ...msg, user: cached }]);
          }
        })
        .subscribe();
    };

    setupRealtime();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [groupId, user?.id]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = newMsg.trim();
    if (!text || sending) return;

    setSending(true);
    setSendError('');
    const { data: inserted, error } = await supabase
      .from('group_messages')
      .insert({
        group_id: groupId,
        user_id: user.id,
        message: text.slice(0, 255),
      })
      .select('*, user:user_id (id, name, avatar_url)')
      .single();

    if (error) {
      setSendError(error.message);
    } else {
      setMessages(prev => [...prev, inserted]);
      setNewMsg('');
    }
    setSending(false);
    inputRef.current?.focus();
  };

  if (loading) {
    return (
      <div className="group-chat">
        <div className="group-chat-header">
          <h3>Chat do Grupo</h3>
        </div>
        <div className="group-chat-loading">
          <Loader2 size={20} className="spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="group-chat">
      <div className="group-chat-header">
        <h3>Chat do Grupo</h3>
        <span className="group-chat-count">{messages.length} mensagem{messages.length !== 1 ? 'ns' : ''}</span>
      </div>

      <div className="group-chat-messages">
        {messages.length === 0 && (
          <div className="group-chat-empty">
            <p>Nenhuma mensagem ainda. Seja o primeiro a enviar!</p>
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.user?.id === user?.id;
          return (
            <div key={msg.id} className={`group-chat-msg ${isMe ? 'mine' : ''}`}>
              {!isMe && (
                <div className="group-chat-msg-avatar">
                  {msg.user?.avatar_url ? (
                    <img src={msg.user.avatar_url} alt="" />
                  ) : (
                    <span>{(msg.user?.name || '?')[0].toUpperCase()}</span>
                  )}
                </div>
              )}
              <div className="group-chat-msg-content">
                {!isMe && <span className="group-chat-msg-name">{msg.user?.name || 'Usuário'}</span>}
                <div className="group-chat-msg-bubble">
                  <p>{msg.message}</p>
                </div>
                <span className="group-chat-msg-time">
                  {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {sendError && <div className="group-chat-error">{sendError}</div>}
      <form className="group-chat-input" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          value={newMsg}
          onChange={e => setNewMsg(e.target.value.slice(0, 255))}
          placeholder="Mensagem (máx. 255 caracteres)..."
          maxLength={255}
        />
        <button type="submit" disabled={!newMsg.trim() || sending}>
          {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}

export default GroupChat;
