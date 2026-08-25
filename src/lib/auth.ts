import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./db";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          active: user.active,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? "operator";
        token.sub = user.id;
      }
      if (token.sub) {
        const account = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { active: true, role: true, name: true, email: true },
        });
        token.accountActive = account?.active ?? false;
        if (account) {
          token.role = account.role;
          token.name = account.name;
          token.email = account.email;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.accountActive === false) {
        delete session.user;
        return session;
      }
      if (session.user) {
        (session.user as { id?: string }).id = token.sub;
        (session.user as { role?: string }).role = (token.role as string) ?? "operator";
        (session.user as { active?: boolean }).active = true;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
