import type { FeatureControls, FeatureState } from '../types';

interface FeatureControlsProps {
  controls: FeatureControls
  onChange: (key: keyof FeatureControls, value: FeatureState) => void
  nightMode: boolean
}

const TriStateButton = ({
  label,
  state,
  onChange,
  nightMode
}: {
  label: string
  state: FeatureState
  onChange: (state: FeatureState) => void
  nightMode: boolean
}) => {
  const getNextState = (current: FeatureState): FeatureState => {
    switch(current) {
      case 'enabled': return 'download-only';
      case 'download-only': return 'disabled';
      case 'disabled': return 'enabled';
    }
  };

  const getStateColor = (state: FeatureState) => {
    switch(state) {
      case 'enabled': return '#4CAF50';
      case 'download-only': return '#FF9800';
      case 'disabled': return '#757575';
    }
  };

  const getStateIcon = (state: FeatureState) => {
    switch(state) {
      case 'enabled': return '✓✓'; // Double check
      case 'download-only': return '↓'; // Download arrow
      case 'disabled': return '✕'; // X
    }
  };

  const getStateLabel = (state: FeatureState) => {
    switch(state) {
      case 'enabled': return 'Download & Render';
      case 'download-only': return 'Download Only';
      case 'disabled': return 'Disabled';
    }
  };

  const textColor = nightMode ? '#e0e0e0' : '#000000';

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '4px'
      }}>
        <span style={{ fontSize: '13px', color: textColor, fontWeight: '500' }}>{label}</span>
        <span style={{ fontSize: '11px', color: getStateColor(state), fontWeight: 'bold' }}>
          {getStateLabel(state)}
        </span>
      </div>
      <button
        onClick={() => onChange(getNextState(state))}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: `2px solid ${getStateColor(state)}`,
          borderRadius: '4px',
          backgroundColor: nightMode ? '#2d2d2d' : '#ffffff',
          color: getStateColor(state),
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'all 0.2s'
        }}
      >
        <span style={{ fontSize: '18px' }}>{getStateIcon(state)}</span>
        <span>Click to toggle</span>
      </button>
    </div>
  );
};

export function FeatureControlsPanel({ controls, onChange, nightMode }: FeatureControlsProps) {
  const borderColor = nightMode ? '#404040' : '#ccc';
  const textColor = nightMode ? '#e0e0e0' : '#000000';

  return (
    <div style={{ padding: '16px', borderBottom: `1px solid ${borderColor}` }}>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', color: textColor, fontWeight: 'bold' }}>
        Feature Controls
      </h2>

      <div style={{ marginBottom: '20px' }}>
        <h3 style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          color: textColor,
          fontWeight: '600',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Map Layers
        </h3>
        <TriStateButton
          label="Boundaries"
          state={controls.boundaries}
          onChange={(state) => onChange('boundaries', state)}
          nightMode={nightMode}
        />
        <TriStateButton
          label="Water"
          state={controls.water}
          onChange={(state) => onChange('water', state)}
          nightMode={nightMode}
        />
        <TriStateButton
          label="Parks & Green Spaces"
          state={controls.parks}
          onChange={(state) => onChange('parks', state)}
          nightMode={nightMode}
        />
        <TriStateButton
          label="Roads"
          state={controls.roads}
          onChange={(state) => onChange('roads', state)}
          nightMode={nightMode}
        />
        <TriStateButton
          label="Buildings"
          state={controls.buildings}
          onChange={(state) => onChange('buildings', state)}
          nightMode={nightMode}
        />
        <TriStateButton
          label="Labels"
          state={controls.labels}
          onChange={(state) => onChange('labels', state)}
          nightMode={nightMode}
        />
      </div>

      <div style={{
        padding: '12px',
        backgroundColor: nightMode ? '#2d2d2d' : '#f5f5f5',
        borderRadius: '4px',
        fontSize: '11px',
        color: textColor,
        lineHeight: '1.4'
      }}>
        <strong>Legend:</strong><br/>
        <span style={{ color: '#4CAF50' }}>✓✓</span> Download & Render - Feature will be fetched and displayed<br/>
        <span style={{ color: '#FF9800' }}>↓</span> Download Only - Feature will be fetched but not displayed<br/>
        <span style={{ color: '#757575' }}>✕</span> Disabled - Feature will not be fetched or displayed
      </div>
    </div>
  );
}
