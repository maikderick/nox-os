import "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      id?: string;
      role?: string;
      active?: boolean;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    role?: string;
    active?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    accountActive?: boolean;
  }
}
