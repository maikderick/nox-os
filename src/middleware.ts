import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: ["/leads/:path*", "/api/leads/:path*", "/api/import/:path*", "/api/settings/:path*", "/api/audit/:path*"],
};
