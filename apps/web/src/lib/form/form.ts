import { createFormHook } from "@tanstack/react-form";

import { fieldContext, formContext } from "./context";
import {
  MarkdownField,
  PhoneField,
  Select,
  SubscribeButton,
  TextArea,
  TextField,
} from "./fields";

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    TextField,
    TextArea,
    MarkdownField,
    Select,
    PhoneField,
  },
  formComponents: {
    SubscribeButton,
  },
  fieldContext,
  formContext,
});
