import { useQuery } from "@tanstack/react-query";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { EditAffordance } from "#/features/landing/components/edit-affordance";
import { FaqEditor } from "#/features/landing/components/faq-editor";

export function Faq() {
  const { data } = useQuery(landingContentQueryOptions());
  const items = data?.faqItems ?? [];

  return (
    <section className="relative border-b py-16 md:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Frequently asked questions
          </h2>
        </div>
        {items.length > 0 ? (
          <Accordion type="single" collapsible className="w-full">
            {items.map((item) => (
              <AccordionItem key={item.id} value={item.id}>
                <AccordionTrigger className="text-left">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            No FAQ items yet.
          </p>
        )}
      </div>
      <EditAffordance label="Edit FAQ">
        {({ close }) => (
          <FaqEditor items={items} onSaved={close} onCancel={close} />
        )}
      </EditAffordance>
    </section>
  );
}
