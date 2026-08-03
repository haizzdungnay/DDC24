package historian

type HotSample struct {
	PointID         string
	Generation      uint64
	BucketUTCMS     int64
	LastSampleUTCMS int64
	Value           float64
	Min             float64
	Max             float64
	Sum             float64
	Count           int
	WorstQuality    int
	Source          string
	PolicyRevision  uint64
}

type HistoryGap struct {
	PointID        string
	Generation     uint64
	FromUTCMS      int64
	ToUTCMS        int64
	Reason         string
	Detail         string
	PolicyRevision *uint64
	CreatedAtUTCMS int64
}
