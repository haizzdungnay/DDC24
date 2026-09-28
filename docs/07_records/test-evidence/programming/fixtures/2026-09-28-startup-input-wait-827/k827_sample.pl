#!/usr/bin/perl
# Bộ lấy mẫu cho lượt kiểm Issue #827 trên bo (chỉ GET).
# Dùng: perl k827_sample.pl <projectId> <out.jsonl> <maxSeconds> [periodMs]
# Dừng sớm khi có file /tmp/k827.stop. Token đọc từ /tmp/.k827tok.
use strict; use warnings;
use IO::Socket::INET; use Time::HiRes qw(time sleep); use JSON::PP;

my ($proj, $out, $max, $period) = @ARGV;
$period ||= 500;
my $tok = do { local $/; open my $f, '<', '/tmp/.k827tok' or die "no token"; <$f> };
$tok =~ s/\s+//g;
my $json = JSON::PP->new->canonical;

sub get {
  my ($path) = @_;
  my $s = IO::Socket::INET->new(PeerAddr => '127.0.0.1', PeerPort => 8082, Proto => 'tcp', Timeout => 3)
    or return (0, undef);
  print $s "GET $path HTTP/1.0\r\nHost: 127.0.0.1\r\nAuthorization: Bearer $tok\r\nConnection: close\r\n\r\n";
  local $/; my $r = <$s>; close $s;
  return (0, undef) unless defined $r;
  my ($head, $body) = split /\r\n\r\n/, $r, 2;
  my ($code) = $head =~ m{^HTTP/\S+\s+(\d+)};
  return ($code || 0, $body);
}

sub dec { my $b = shift; return undef unless defined $b; my $v = eval { $json->decode($b) }; return $v; }

open my $o, '>', $out or die "open $out: $!";
select((select($o), $| = 1)[0]);
my $t0 = time; my $n = 0; my $lastPoints = 0; my $lastFrames = 0; my $lastFrameAt = 0;
while (time - $t0 < $max) {
  last if -e '/tmp/k827.stop';
  my $ts = time; my %rec = (t => int($ts * 1000));
  my ($c1, $b1) = get("/api/v1/programming/projects/$proj/programs");
  my $p = dec($b1);
  $rec{progHttp} = $c1;
  if ($p && ref $p->{items} eq 'ARRAY') {
    $rec{prog} = [ map { my $i = $_; +{ map { $_ => $i->{$_} } qw(programId desiredEnabled enabled runtimeState coreState waitingReason faultCount lastFaultCode lastRunAtUtc lastRunAgeMs health generation) } } @{$p->{items}} ];
    $rec{src} = $p->{runtimeStateSource};
  }
  my ($c2, $b2) = get("/api/v1/programming/runtime");
  my $r = dec($b2);
  $rec{rtHttp} = $c2;
  if ($r) { $rec{rt} = { map { $_ => $r->{$_} } qw(producerState activeRevisionId taskState) }; }
  my ($c3, $b3) = get("/api/v1/health");
  my $h = dec($b3);
  $rec{hHttp} = $c3;
  if ($h && ref $h->{checks} eq 'HASH') {
    my @bad = grep { ($h->{checks}{$_}{status} // '') ne 'ok' } sort keys %{$h->{checks}};
    $rec{health} = { status => $h->{status}, n => scalar(keys %{$h->{checks}}), bad => \@bad };
  }
  if ($ts - $lastFrames >= 5) {
    $lastFrames = $ts;
    my ($c5, $b5) = get("/api/v1/modbus/frames?bus=1");
    my $fr = dec($b5);
    $rec{frHttp} = $c5;
    if ($fr && ref $fr->{frames} eq 'ARRAY') {
      my @new = grep { $_->{at} >= $lastFrameAt } @{$fr->{frames}};
      for (@new) { $lastFrameAt = $_->{at} if $_->{at} > $lastFrameAt; }
      $rec{fr} = [ map { [ $_->{at}, $_->{slave}, $_->{fc}, $_->{addr}, $_->{count}, ($_->{ok} ? 1 : 0), $_->{values} ] } @new ];
    }
  }
  if ($ts - $lastPoints >= 0.95) {
    $lastPoints = $ts;
    my ($c4, $b4) = get("/api/v1/points");
    my $pts = dec($b4);
    $rec{ptHttp} = $c4;
    if ($pts && ref $pts eq 'ARRAY') {
      my %do = map { $_->{id} => [ $_->{value}, $_->{quality}, $_->{updatedAt} ] } grep { ($_->{id} // '') =~ /^CK5080[45]-DO\d$/ } @$pts;
      $rec{do} = \%do;
    }
  }
  print $o $json->encode(\%rec), "\n";
  $n++;
  my $wait = $period / 1000 - (time - $ts);
  sleep($wait) if $wait > 0;
}
close $o;
print "samples=$n\n";
