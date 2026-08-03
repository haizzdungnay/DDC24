package app

import "time"

func manualTimeCommandValue(instant time.Time, timezone string) (string, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return "", err
	}
	return instant.In(location).Format("2006-01-02 15:04:05"), nil
}
