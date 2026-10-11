import { useQuery } from '@tanstack/react-query';
import * as api from './api';

export const planKeys = { info: ['plan'] as const };

export const usePlanInfo = () => useQuery({ queryKey: planKeys.info, queryFn: api.getPlanInfo });
