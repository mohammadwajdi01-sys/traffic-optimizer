// Match the symbol set supported by Supabase Auth's strongest password requirement.
const symbols = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
export function passwordChecks(password:string):boolean[] {
  return [Array.from(password).length>=8,/[A-Z]/.test(password),/[a-z]/.test(password),/[0-9]/.test(password),Array.from(password).some(character=>symbols.includes(character))];
}
export const validNewPassword=(password:string)=>passwordChecks(password).every(Boolean);
