import type { EmergencyContactInput } from "#/features/auth/server/server-fns";

/**
 * Shape of every profile-editing form in the app: registration, the
 * `/account` Profile tab, the `/account/details` Details tab, and the
 * admin profile sheet. Kept as a single shape because TanStack Form's
 * `withForm` HOC has invariant generics — a field-group component
 * can't accept both a wider and a narrower parent form, so all
 * parents and all field groups must agree.
 *
 * Routes that only edit a subset (Profile = preferredName +
 * ucAffiliation; Details = fullName/mNumber/phone + emergency
 * contacts) still initialize the full shape, but their server-fn
 * submission only picks the relevant fields.
 */
export interface ProfileFormShape {
  fullName: string;
  preferredName: string;
  mNumber: string;
  phone: string;
  emergencyContacts: EmergencyContactInput[];
  ucAffiliation: "" | "student" | "faculty" | "staff" | "alum" | "community";
  bio: string;
}

export const EMPTY_PROFILE_FORM_VALUES: ProfileFormShape = {
  fullName: "",
  preferredName: "",
  mNumber: "",
  phone: "",
  emergencyContacts: [],
  ucAffiliation: "",
  bio: "",
};
