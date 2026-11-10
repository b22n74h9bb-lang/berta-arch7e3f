import { trpc } from "@/providers/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { LOGIN_PATH } from "@/const";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = LOGIN_PATH } = options ?? {};
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: user, isLoading, error, refetch } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5000,
    retry: false,
    refetchInterval: (query) => (query.state.data ? 5000 : false),
  });
  const sessionDead = (error as { data?: { code?: string } } | null)?.data?.code === "UNAUTHORIZED";
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      navigate(redirectPath);
    },
  });
  const logout = useCallback(() => logoutMutation.mutate(), [logoutMutation]);

  useEffect(() => {
    if (redirectOnUnauthenticated && !isLoading && !user) {
      const currentPath = window.location.pathname;
      if (currentPath !== redirectPath) navigate(redirectPath);
    }
  }, [redirectOnUnauthenticated, isLoading, user, navigate, redirectPath]);

  return useMemo(
    () => ({
      user: sessionDead ? null : user ?? null,
      isAuthenticated: Boolean(user) && !sessionDead,
      isLoading: isLoading || logoutMutation.isPending,
      error,
      logout,
      refresh: refetch,
    }),
    [user, sessionDead, isLoading, logoutMutation.isPending, error, logout, refetch],
  );
}
