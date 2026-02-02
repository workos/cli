import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'guest';
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

interface Credentials {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => Promise<void>;
  updatePreferences: (prefs: Partial<User['preferences']>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const stored = localStorage.getItem('auth_user');
        if (stored) {
          setUser(JSON.parse(stored));
        }
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
  }, []);

  const login = useCallback(async (credentials: Credentials) => {
    setIsLoading(true);
    try {
      // Simulated API call - in real app this would hit your backend
      await new Promise((resolve) => setTimeout(resolve, 500));

      const mockUser: User = {
        id: '123',
        email: credentials.email,
        name: credentials.email.split('@')[0] ?? 'User',
        role: 'user',
        preferences: {
          theme: 'light',
          notifications: true,
        },
      };

      localStorage.setItem('auth_user', JSON.stringify(mockUser));
      setUser(mockUser);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      localStorage.removeItem('auth_user');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updatePreferences = useCallback(
    async (prefs: Partial<User['preferences']>) => {
      if (!user) return;

      const updatedUser = {
        ...user,
        preferences: { ...user.preferences, ...prefs },
      };
      localStorage.setItem('auth_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
