import { useState } from 'react';
import { View } from 'react-native';
import type { LegalDoc } from '@outletbooking/shared';
import { t } from '@/strings/en';
import { StackScreen } from './StackScreen';
import { Card } from './ui/Card';
import { Chip } from './ui/Chip';
import { Text } from './ui/Text';

/** One version of a legal text, with the name shown on its language switch ("English"). */
export interface LegalVersion {
  label: string;
  doc: LegalDoc;
}

/**
 * Privacy notice / terms / refund policy page (public: `/privacy`, `/terms`, `/refund`). The text comes from
 * `docs/legal/*.md` through `packages/shared` (`pnpm legal:generate`). With more than one version (the privacy notice in
 * English and Bahasa Melayu, as PDPA s.7(3) requires) a switch at the top picks the language.
 */
export function LegalPage({ versions }: { versions: LegalVersion[] }) {
  const [index, setIndex] = useState(0);
  const doc = versions[index]!.doc;
  return (
    <StackScreen title={doc.title} subtitle={t.legal.updated(doc.updated)} backHref="/">
      {versions.length > 1 ? (
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {versions.map((v, i) => (
            <Chip key={v.label} role="radio" label={v.label} selected={i === index} onPress={() => setIndex(i)} />
          ))}
        </View>
      ) : null}
      {doc.intro ? <Text className="text-[15px] leading-[22px]">{doc.intro}</Text> : null}
      {doc.sections.map((section) => (
        <Card key={section.heading} className="gap-2 p-4">
          <Text className="text-[16px] font-extrabold" accessibilityRole="header">
            {section.heading}
          </Text>
          {section.body.map((para) =>
            para.startsWith('• ') ? (
              <View key={para} className="flex-row gap-2 pl-1">
                <Text className="text-[14px] leading-[21px] text-muted">•</Text>
                <Text className="flex-1 text-[14px] leading-[21px] text-muted">{para.slice(2)}</Text>
              </View>
            ) : (
              <Text key={para} className="text-[14px] leading-[21px] text-muted">
                {para}
              </Text>
            ),
          )}
        </Card>
      ))}
    </StackScreen>
  );
}
