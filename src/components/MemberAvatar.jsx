import { useState } from 'react';

/**
 * Avatar de um membro do grupo.
 *
 * Foto de perfil quando a pessoa tem uma; inicial do primeiro nome quando não
 * tem (ou quando a foto não carrega — URL quebrada/storage removido).
 *
 * Aceita o membro já montado (`member.user.avatar_url`) ou os valores
 * separados (`name` / `photo`), para quem não tem o objeto `user`.
 */
export default function MemberAvatar({ member, name, photo, className = '', style, title }) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const displayName = name ?? member?.user?.name ?? member?.profile_name ?? '';
  const photoUrl = photo ?? member?.user?.avatar_url ?? '';
  const initial = (displayName.trim()[0] || '?').toUpperCase();

  return (
    <div
      className={className}
      style={style}
      title={title ?? (displayName || 'Membro')}
    >
      {photoUrl && !photoFailed ? (
        <img src={photoUrl} alt={displayName} onError={() => setPhotoFailed(true)} />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
