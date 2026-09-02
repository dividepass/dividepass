import { useState, useEffect, useRef } from 'react';
import { Search, X, Users, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './SearchSelect.css';

export function UserSearchSelect({ selected, onChange, placeholder = 'Buscar usuário por nome ou e-mail...' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [searchError, setSearchError] = useState('');
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setSearchError('');
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setSearchError('');
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, name, email, role')
          .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
          .limit(15);

        if (error) {
          console.error('[UserSearchSelect] query error:', error);
          setSearchError('Erro na busca: ' + error.message);
          setResults([]);
        } else {
          setResults(data || []);
        }
        setOpen(true);
      } catch (err) {
        console.error('[UserSearchSelect] catch error:', err);
        setSearchError('Erro inesperado: ' + err.message);
        setResults([]);
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const isSelected = (id) => selected.some(u => u.id === id);

  const toggleUser = (user) => {
    if (isSelected(user.id)) {
      onChange(selected.filter(u => u.id !== user.id));
    } else {
      onChange([...selected, { id: user.id, name: user.name, email: user.email }]);
    }
  };

  const removeUser = (id) => {
    onChange(selected.filter(u => u.id !== id));
  };

  return (
    <div className="search-select-wrapper" ref={wrapperRef}>
      {selected.length > 0 && (
        <div className="search-select-tags">
          {selected.map(u => (
            <span key={u.id} className="search-select-tag">
              <User size={12} />
              {u.name || u.email}
              <button type="button" onClick={() => removeUser(u.id)} className="search-select-tag-remove">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="search-select-input-wrapper">
        <Search size={16} className="search-select-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length >= 2) setOpen(true); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="search-select-input"
        />
        {loading && <span className="search-select-spinner" />}
      </div>
      {searchError && (
        <div className="search-select-error">{searchError}</div>
      )}
      {open && (
        <div className="search-select-dropdown">
          {results.length > 0 ? results.map(user => (
            <button
              key={user.id}
              type="button"
              className={`search-select-option ${isSelected(user.id) ? 'selected' : ''}`}
              onClick={() => toggleUser(user)}
            >
              <div className="search-select-option-info">
                <span className="search-select-option-name">{user.name || 'Sem nome'}</span>
                <span className="search-select-option-email">{user.email}</span>
              </div>
              {isSelected(user.id) && <span className="search-select-check">✓</span>}
            </button>
          )) : !loading && !searchError && (
            <div className="search-select-empty">Nenhum usuário encontrado</div>
          )}
        </div>
      )}
    </div>
  );
}

export function GroupSearchSelect({ selected, onChange, placeholder = 'Buscar grupo por nome...' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selected) {
      setMembers([]);
      return;
    }
    const loadMembers = async () => {
      setMembersLoading(true);
      const { data } = await supabase
        .from('group_members')
        .select('user_id, profile_name, status, user:user_id(name, email)')
        .eq('group_id', selected.id)
        .in('status', ['active', 'pending']);
      setMembers(data || []);
      setMembersLoading(false);
    };
    loadMembers();
  }, [selected]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from('groups')
        .select('id, name, service:service_id(name, icon), owner:owner_id(name)')
        .ilike('name', `%${q}%`)
        .limit(10);
      setResults(data || []);
      setLoading(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const selectGroup = (group) => {
    onChange({ id: group.id, name: group.name, service: group.service, owner: group.owner });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const clearGroup = () => {
    onChange(null);
    setMembers([]);
  };

  return (
    <div className="search-select-wrapper" ref={wrapperRef}>
      {selected && (
        <div className="search-select-tags">
          <span className="search-select-tag">
            {selected.service?.icon || '👥'} {selected.name}
            <button type="button" onClick={clearGroup} className="search-select-tag-remove">
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      <div className="search-select-input-wrapper">
        <Search size={16} className="search-select-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length >= 2) setOpen(true); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={selected ? 'Grupo selecionado' : placeholder}
          className="search-select-input"
          disabled={!!selected}
        />
        {loading && <span className="search-select-spinner" />}
      </div>
      {open && (
        <div className="search-select-dropdown">
          {results.length > 0 ? results.map(group => (
            <button
              key={group.id}
              type="button"
              className={`search-select-option ${selected?.id === group.id ? 'selected' : ''}`}
              onClick={() => selectGroup(group)}
            >
              <div className="search-select-option-info">
                <span className="search-select-option-name">
                  {group.service?.icon || '👥'} {group.name}
                </span>
                <span className="search-select-option-email">
                  {group.service?.name || 'Serviço'}
                  {group.owner?.name ? ` • Dono: ${group.owner.name}` : ''}
                </span>
              </div>
            </button>
          )) : !loading && (
            <div className="search-select-empty">Nenhum grupo encontrado</div>
          )}
        </div>
      )}

      {selected && (
        <div className="group-members-preview">
          <div className="group-members-header">
            <Users size={14} />
            <span>
              {membersLoading
                ? 'Carregando membros...'
                : `${members.length} membro${members.length !== 1 ? 's' : ''} receberá a notificação`
              }
            </span>
          </div>
          {!membersLoading && members.length > 0 && (
            <div className="group-members-list">
              {members.map((m, i) => (
                <div key={m.user_id || i} className="group-member-item">
                  <div className="group-member-avatar">
                    {m.user?.name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="group-member-info">
                    <span className="group-member-name">
                      {m.user?.name || 'Sem nome'}
                      {m.profile_name && <span className="group-member-profile"> ({m.profile_name})</span>}
                    </span>
                    <span className="group-member-email">{m.user?.email || ''}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!membersLoading && members.length === 0 && (
            <div className="group-members-empty">Nenhum membro ativo neste grupo</div>
          )}
        </div>
      )}
    </div>
  );
}
