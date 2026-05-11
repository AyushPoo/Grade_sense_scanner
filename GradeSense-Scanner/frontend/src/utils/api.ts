import axios from 'axios';
import { CONFIG } from '../config';
import { Batch, User } from '../types';

const api = axios.create({
  baseURL: CONFIG.API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Mock data for development
const MOCK_BATCHES: Batch[] = [
  { batch_id: 'batch_001', name: 'UPSC 2025 Batch A', student_count: 120 },
  { batch_id: 'batch_002', name: 'UPSC 2025 Batch B', student_count: 95 },
  { batch_id: 'batch_003', name: 'CA Foundation 2025', student_count: 80 },
  { batch_id: 'batch_004', name: 'GATE CSE 2025', student_count: 150 },
  { batch_id: 'batch_005', name: 'Medical Entrance Batch', student_count: 200 },
];

const MOCK_STUDENTS = [
  { student_id: 'stu_001', roll_number: '1001', name: 'Rahul Kumar' },
  { student_id: 'stu_002', roll_number: '1002', name: 'Priya Sharma' },
  { student_id: 'stu_003', roll_number: '1003', name: 'Amit Singh' },
  { student_id: 'stu_004', roll_number: '1004', name: 'Sneha Patel' },
  { student_id: 'stu_005', roll_number: '1005', name: 'Vikram Reddy' },
];

// Auth API
export const authApi = {
  processSession: async (sessionId: string): Promise<{ user: User; session_token: string }> => {
    try {
      const response = await api.get('/api/auth/session', {
        headers: { 'X-Session-ID': sessionId },
      });
      return response.data;
    } catch (error) {
      console.error('Auth session error:', error);
      throw error;
    }
  },

  getMe: async (token: string): Promise<User> => {
    try {
      const response = await api.get('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return response.data;
    } catch (error) {
      console.error('Get me error:', error);
      throw error;
    }
  },

  logout: async (token: string): Promise<void> => {
    try {
      await api.post('/api/auth/logout', {}, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  },
};

// Batches API
export const batchesApi = {
  getBatches: async (token?: string): Promise<Batch[]> => {
    // Return mock data for now
    return new Promise((resolve) => {
      setTimeout(() => resolve(MOCK_BATCHES), 500);
    });
  },

  getStudentsByBatch: async (batchId: string, token?: string) => {
    // Return mock data
    return new Promise((resolve) => {
      setTimeout(() => resolve(MOCK_STUDENTS), 300);
    });
  },
};

// Scan Sessions API
export const scanSessionsApi = {
  create: async (sessionData: any, token?: string) => {
    // Mock implementation
    return new Promise((resolve) => {
      setTimeout(() => resolve({ session_id: sessionData.session_id || `sess_${Date.now()}` }), 300);
    });
  },

  uploadQuestionPaper: async (sessionId: string, images: any[], token?: string) => {
    // Mock implementation - simulate upload delay
    return new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'success', pages_received: images.length }), 1000);
    });
  },

  uploadModelAnswer: async (sessionId: string, images: any[], token?: string) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'success', pages_received: images.length }), 1000);
    });
  },

  uploadStudent: async (sessionId: string, studentData: any, token?: string) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'success', pages_received: studentData.images?.length || 0 }), 1500);
    });
  },

  complete: async (sessionId: string, stats: any, token?: string) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ exam_id: `exam_${Date.now()}`, status: 'completed' }), 500);
    });
  },

  getStatus: async (sessionId: string, token?: string) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'ready', progress: 100 }), 300);
    });
  },
};

export default api;
