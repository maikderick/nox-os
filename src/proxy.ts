import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
  callbacks: {
    authorized: ({ token }) => Boolean(token),
  },
});

export const config = {
  matcher: [
    "/leads/:path*",
    "/api/leads/:path*",
    "/api/import/:path*",
    "/api/settings/:path*",
    "/api/audit/:path*",
    "/api/account/:path*",
    "/api/users/:path*",
  ],
};
