import { supabase } from './supabase';
import { optimizeImage } from './imageOptimizer';

const AVATAR_BUCKET = 'profile-photos';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Valida, otimiza e sobe uma imagem para o bucket de perfil.
 * Retorna a URL pública ou lança um erro com mensagem em português.
 */
export async function uploadAvatarFile(file, userId) {
  if (!file) throw new Error('Nenhuma imagem selecionada.');

  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.');
  }

  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('A imagem é muito grande. O limite é 5MB.');
  }

  const optimized = await optimizeImage(file, 'avatar');
  const ext = optimized.name.split('.').pop() || 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, optimized, { upsert: true });

  if (error) throw new Error('Erro no upload: ' + error.message);

  const { data: urlData } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(path);

  if (!urlData?.publicUrl) throw new Error('Não foi possível gerar a URL da imagem.');

  return urlData.publicUrl;
}

/**
 * Sobe o avatar e grava em users.avatar_url.
 */
export async function saveAvatar(file, userId) {
  const publicUrl = await uploadAvatarFile(file, userId);

  const { error } = await supabase
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);

  if (error) throw new Error('Erro ao salvar o avatar: ' + error.message);

  return publicUrl;
}