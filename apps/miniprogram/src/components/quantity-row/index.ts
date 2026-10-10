import {
  addQuantities,
  compareQuantities,
  subtractQuantities,
  type Archive,
  type QuantityLine,
} from '@warehouse/contracts';
type RowProperties = {
  options: { type: ArrayConstructor; value: Archive[] };
  value: { type: ObjectConstructor; value: QuantityLine };
  index: { type: NumberConstructor; value: number };
  disabled: { type: BooleanConstructor; value: boolean };
};
interface RowState {
  selectedName: string;
  selectedUnit: string;
  inputType: 'number' | 'digit';
}
Component<
  RowState,
  RowProperties,
  {
    choose(event: { detail: { value: string } }): void;
    quantity(event: { detail: { value: string } }): void;
    step(event: { currentTarget: { dataset: { delta: string } } }): void;
    chooseItem(event: { currentTarget: { dataset: { id: number } } }): void;
    remove(): void;
  },
  []
>({
  properties: {
    options: { type: Array, value: [] },
    value: { type: Object, value: { itemId: 0, quantity: '' } },
    index: { type: Number, value: 0 },
    disabled: { type: Boolean, value: false },
  },
  data: { selectedName: '', selectedUnit: '', inputType: 'number' },
  observers: {
    'options,value': function (options: Archive[], value: QuantityLine) {
      const selected = options.find((item) => item.id === value.itemId);
      this.setData({
        selectedName: selected?.name ?? '',
        selectedUnit: selected?.unit ?? '',
        inputType: selected?.unit === '公斤' ? 'digit' : 'number',
      });
    },
  },
  methods: {
    choose(event) {
      if (this.data.disabled) {
        return;
      }
      const selected = this.data.options[Number(event.detail.value)];
      if (selected) {
        this.triggerEvent('change', {
          index: this.data.index,
          line: { ...this.data.value, itemId: selected.id, quantity: '' },
        });
      }
    },
    chooseItem(event) {
      if (this.data.disabled) {
        return;
      }
      const selected = this.data.options.find(
        (item) => item.id === Number(event.currentTarget.dataset.id),
      );
      if (selected) {
        this.triggerEvent('change', {
          index: this.data.index,
          line: { ...this.data.value, itemId: selected.id, quantity: '' },
        });
      }
    },
    quantity(event) {
      if (!this.data.disabled) {
        this.triggerEvent('change', {
          index: this.data.index,
          line: { ...this.data.value, quantity: event.detail.value.trim() },
        });
      }
    },
    step(event) {
      if (this.data.disabled) {
        return;
      }
      const current = this.data.value.quantity || '0';
      if (!/^\d+(\.\d{1,3})?$/.test(current)) {
        return;
      }
      const next =
        event.currentTarget.dataset.delta === '1'
          ? addQuantities(current, '1')
          : compareQuantities(current, '1') < 0
            ? '0'
            : subtractQuantities(current, '1');
      this.triggerEvent('change', {
        index: this.data.index,
        line: { ...this.data.value, quantity: next },
      });
    },
    remove() {
      if (!this.data.disabled) {
        this.triggerEvent('remove', { index: this.data.index });
      }
    },
  },
});
