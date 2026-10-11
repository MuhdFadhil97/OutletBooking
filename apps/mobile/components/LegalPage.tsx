import { View } from 'react-native';
import type { LegalDoc } from '@outletbooking/shared';
import { t } from '@/strings/en';
import { StackScreen } from './StackScreen';
import { Card } from './ui/Card';
import { Text } from './ui/Text';

/** Privacy notice / terms page (public: `/privacy`, `/terms`). Text lives in `packages/shared/src/legal.ts`. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <StackScreen title={doc.title} subtitle={t.legal.updated(doc.updated)} backHref="/">
      <Text className="text-[15px] leading-[22px]">{doc.intro}</Text>
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
