import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { optimizeImage } from '../lib/imageOptimizer';

const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export function useSupportImageUpload() {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');

  const handleImageChange = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem.');
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      alert(`Imagem muito grande. Máximo ${MAX_SIZE_MB}MB.`);
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }, []);

  const removeImage = useCallback(() => {
    setImageFile(null);
    setImagePreview('');
  }, []);

  const uploadImage = useCallback(async () => {
    if (!imageFile) return null;
    const optimized = await optimizeImage(imageFile, 'support');
    const ext = optimized.name.split('.').pop();
    const fileName = `support/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('support-images')
      .upload(fileName, optimized);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('support-images').getPublicUrl(fileName);
    return data.publicUrl;
  }, [imageFile]);

  return { imageFile, imagePreview, handleImageChange, removeImage, uploadImage };
}
