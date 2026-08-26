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
    "/projetos/:path*",
    "/organizacao/:path*",
    "/api/leads/:path*",
    "/api/import/:path*",
    "/api/settings/:path*",
    "/api/audit/:path*",
    "/api/account/:path*",
    "/api/users/:path*",
    "/api/organizations/:path*",
    "/api/projects/:path*",
    "/api/demo-landings/:path*",
    "/api/geocode/:path*",
    "/api/stock-photos/:path*",
  ],
};
