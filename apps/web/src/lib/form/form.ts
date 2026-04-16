import { createFormHook } from "@tanstack/react-form";

import { fieldContext, formContext } from "./context";
import {
  PhoneField,
  Select,
  SubscribeButton,
  TextArea,
  TextField,
} from "./fields";

export const { useAppForm } = createFormHook({
  fieldComponents: {
    TextField,
    TextArea,
    Select,
    PhoneField,
  },
  formComponents: {
    SubscribeButton,
  },
  fieldContext,
  formContext,
});
