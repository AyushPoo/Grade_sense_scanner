import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_REVIEW_DENSITY,
  isReviewDensity,
  ReviewDensity,
} from '../utils/reviewDensity';

const REVIEW_DENSITY_STORAGE_KEY = 'gradesense.reviewDensity';

export function useReviewDensityPreference() {
  const [density, setDensityState] = useState<ReviewDensity>(DEFAULT_REVIEW_DENSITY);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(REVIEW_DENSITY_STORAGE_KEY)
      .then(value => {
        if (isMounted && isReviewDensity(value)) {
          setDensityState(value);
        }
      })
      .catch(error => {
        console.warn('Failed to load review density preference:', error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const setDensity = (nextDensity: ReviewDensity) => {
    setDensityState(nextDensity);
    AsyncStorage.setItem(REVIEW_DENSITY_STORAGE_KEY, nextDensity).catch(error => {
      console.warn('Failed to save review density preference:', error);
    });
  };

  return { density, setDensity };
}
