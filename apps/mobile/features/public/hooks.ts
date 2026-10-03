import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const usePublicBusiness = (slug: string) =>
  useQuery({ queryKey: ['public-business', slug], queryFn: () => api.getPublicBusiness(slug), enabled: !!slug });
